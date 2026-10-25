/** Deterministic UI acceptance. All generated weather is SYNTHETIC TEST DATA. */
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {startServer} from '../server/index.mjs';
import {fixturePoint} from '../server/weather.mjs';

const artifacts = resolve('artifacts');
await mkdir(artifacts, {recursive: true});
await stat(resolve('dist/index.html')).catch(() => { throw new Error('Build the application first: npm run build'); });
const dataDir = await mkdtemp(join(tmpdir(), 'teller-ui-fixture-'));
let instance, browser, context, page;
const checks = [], pageErrors = [], consoleErrors = [], network = {requests: 0, completedResponses: 0, declaredTransferBytes: 0, failed: []};
const report = {
  label: 'SYNTHETIC FIXTURE — does not verify live data or macOS',
  startedAt: new Date().toISOString(),
  host: {platform: process.platform, arch: process.arch, node: process.version},
  viewport: {width: 1440, height: 1000, deviceScaleFactor: 1},
  renderer: 'Chromium headless; forced SwiftShader software GPU; not representative of Apple Silicon hardware',
  checks, network,
  limitations: ['No live weather feeds exercised.', 'Linux Chromium is not the packaged Electron application or macOS target.', 'Short fixture playback measures neither prolonged-operation stability nor operational accuracy.'],
};
const check = async (name, action) => {
  const started = performance.now();
  await action();
  checks.push({name, status: 'passed', elapsedMs: Math.round(performance.now() - started)});
  console.log(`PASS ${name}`);
};
async function displayed(which = 0) {
  return page.evaluate(index => {
    const values = window.__tellerTest?.getMaps?.() || [];
    const value = values[index];
    const renderer = value?.renderer || value?.view || value;
    return renderer?.displayed ? {frameId: renderer.displayed.frame.id, time: renderer.displayed.frame.time, productId: renderer.displayed.product.id} : null;
  }, which);
}
async function waitDisplayed(productId, frameId, which = 0) {
  await page.waitForFunction(({productId, frameId, which}) => {
    const value = window.__tellerTest?.getMaps?.()?.[which];
    const renderer = value?.renderer || value?.view || value;
    return renderer?.displayed && (!productId || renderer.displayed.product.id === productId) && (!frameId || renderer.displayed.frame.id === frameId);
  }, {productId, frameId, which}, {timeout: 25_000});
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function setTimeline(index) {
  await page.locator('#timeline').evaluate((element, value) => {
    element.value = String(value);
    element.dispatchEvent(new Event('input', {bubbles: true}));
    element.dispatchEvent(new Event('change', {bubbles: true}));
  }, index);
}
async function canvasHash() {
  const data = await page.evaluate(() => {
    const value = window.__tellerTest.getMaps()[0];
    const renderer = value?.renderer || value?.view || value;
    return renderer.map.getCanvas().toDataURL('image/png');
  });
  return createHash('sha256').update(data).digest('hex');
}
async function sampleFrames(pan = false) {
  return page.evaluate(async pan => {
    const value = window.__tellerTest.getMaps()[0];
    const renderer = value?.renderer || value?.view || value;
    if (pan) {
      const camera = renderer.getView();
      renderer.map.easeTo({center: [camera.center[0] + 0.3, camera.center[1] + 0.1], duration: 1800});
    }
    const frames = [], start = performance.now();
    let last = start;
    await new Promise(resolve => {
      function next(now) {
        frames.push(now - last);
        last = now;
        if (frames.length >= 120) resolve(); else requestAnimationFrame(next);
      }
      requestAnimationFrame(next);
    });
    const sorted = [...frames].sort((a,b) => a-b);
    return {samples: frames.length, elapsedMs: performance.now() - start, medianMs: sorted[Math.floor(sorted.length * 0.5)], p95Ms: sorted[Math.floor(sorted.length * 0.95)], worstMs: sorted.at(-1), over33ms: frames.filter(time => time > 33.34).length};
  }, pan);
}
try {
  instance = await startServer({port: 0, dataDir, fixture: true});
  browser = await chromium.launch({executablePath: process.env.TELLER_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  context = await browser.newContext({viewport: report.viewport, deviceScaleFactor: report.viewport.deviceScaleFactor, acceptDownloads: true});
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.location().url?.includes('favicon.ico')) consoleErrors.push({text: message.text(), location: message.location()});
  });
  page.on('request', () => network.requests++);
  page.on('requestfailed', request => network.failed.push({url: request.url().replace(instance.url, ''), error: request.failure()?.errorText}));
  page.on('response', response => {
    network.completedResponses++;
    const declared = Number(response.headers()['content-length']);
    if (Number.isFinite(declared)) network.declaredTransferBytes += declared;
  });
  const launch = performance.now();
  await page.goto(instance.url, {waitUntil: 'domcontentloaded'});
  await check('actual synthetic weather texture loads', async () => {
    await page.waitForFunction(() => window.__tellerReady?.ready === true, null, {timeout: 40_000});
    report.timeToFirstUsableFixtureMs = Math.round(performance.now() - launch);
    assert.match(await page.locator('#source-status').innerText(), /fixture|synthetic|test data/i);
    await waitDisplayed();
    const image = await page.evaluate(() => {
      const value = window.__tellerTest.getMaps()[0];
      const renderer = value?.renderer || value?.view || value;
      const canvas = renderer.map.getCanvas();
      const copy = document.createElement('canvas');
      copy.width = canvas.width; copy.height = canvas.height;
      const context = copy.getContext('2d'); context.drawImage(canvas, 0, 0);
      const pixels = context.getImageData(0, 0, copy.width, copy.height).data, colors = new Set();
      for (let i=0; i<pixels.length; i+=400) colors.add(`${pixels[i]},${pixels[i+1]},${pixels[i+2]}`);
      const gl = canvas.getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return {colors: colors.size, width: canvas.width, height: canvas.height, gpuRenderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unavailable'};
    });
    report.canvas = image;
    assert.ok(image.colors > 10, `Expected rendered cartography/weather colors, saw ${image.colors}`);
  });
  await check('small native-size windows keep real timeline clicks unobstructed', async () => {
    await page.setViewportSize({width:980,height:640});
    const before=await displayed();
    const button=page.locator('#prev');
    assert.equal(await button.evaluate(element=>{const r=element.getBoundingClientRect();return element.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'A floating panel must not cover the timeline');
    await button.click();
    await page.waitForFunction(id=>window.__tellerTest.getMaps()[0].displayed?.frame.id!==id,before.frameId);
    await waitDisplayed();
    await page.screenshot({path:join(artifacts,'fixture-small-window.png')});
    await page.setViewportSize({width:1440,height:1000});
    await waitDisplayed();
  });
  await check('frame scrubbing changes displayed time and actual raster pixels', async () => {
    const before = await displayed(), hashBefore = await canvasHash();
    await setTimeline(0);
    await page.waitForFunction(old => {
      const value = window.__tellerTest.getMaps()[0];
      return (value?.renderer || value?.view || value)?.displayed?.frame.id !== old;
    }, before.frameId);
    await waitDisplayed();
    const after = await displayed(), hashAfter = await canvasHash();
    assert.notEqual(after.time, before.time);
    assert.notEqual(hashAfter, hashBefore, 'Texture must change, not just the timeline label');
    assert.doesNotMatch(await page.locator('#frame-time').innerText(), /No verified frame|Waiting/i);
  });
  await check('playback advances an actual displayed frame', async () => {
    const before = await displayed();
    await page.locator('#play').click();
    await page.waitForFunction(old => {
      const value = window.__tellerTest.getMaps()[0];
      return (value?.renderer || value?.view || value)?.displayed?.frame.id !== old;
    }, before.frameId, {timeout: 12_000});
    await page.locator('#play').click();
  });
  await check('radar/satellite fixture product selector changes actual layer', async () => {
    await page.locator('.pane-product').first().selectOption('fixture-ir');
    await waitDisplayed('fixture-ir');
    assert.match(await page.locator('.pane-product').first().innerText(), /synthetic/i);
    await page.locator('.pane-product').first().selectOption('fixture-radar');
    await waitDisplayed('fixture-radar');
  });
  await check('two/four map layouts load and linked cameras synchronize', async () => {
    for (const count of [2, 4]) {
      await page.locator(`[data-layout="${count}"]`).click();
      await page.locator(`#maps.layout-${count}`).waitFor();
      await page.waitForFunction(count => window.__tellerTest.getMaps().length === count, count);
      for (let index=0;index<count;index++) await waitDisplayed(null, null, index);
      assert.equal(await page.locator('.maplibregl-canvas').count(), count);
    }
    await page.evaluate(() => {
      const value = window.__tellerTest.getMaps()[0];
      (value?.renderer || value?.view || value).setView({center: [-104.9, 39.1], zoom: 7.4, bearing: 0, pitch: 0});
    });
    await page.waitForFunction(() => {
      const views = window.__tellerTest.getMaps().map(value => (value?.renderer || value?.view || value).getView());
      return views.every(view => Math.abs(view.center[0] + 104.9) < 1e-5 && Math.abs(view.zoom - 7.4) < 1e-5);
    });
    await page.screenshot({path: join(artifacts, 'fixture-four-maps.png'), fullPage: true});
    await page.locator('[data-layout="1"]').click();
    await waitDisplayed();
  });
  await check('light/dark theme and source metadata controls work', async () => {
    const original = await page.locator('html').getAttribute('data-theme') || await page.locator('body').getAttribute('data-theme');
    await page.locator('#theme').click();
    await page.screenshot({path: join(artifacts, 'fixture-light-workspace.png'), fullPage: true});
    const changed = await page.locator('html').getAttribute('data-theme') || await page.locator('body').getAttribute('data-theme');
    assert.notEqual(changed, original);
    await page.locator('#theme').click();
    await page.locator('#metadata-open').click();
    await page.locator('#details-dialog[open]').waitFor();
    assert.match(await page.locator('#details-content').innerText(), /synthetic|fixture|source/i);
    await page.locator('[data-close="details-dialog"]').click();
  });
  await check('opacity, overlay visibility, site camera and collapsible controls work', async () => {
    await page.locator('#opacity').evaluate(element => {element.value='45';element.dispatchEvent(new Event('input', {bubbles:true}));});
    await page.waitForFunction(() => {
      const renderer=window.__tellerTest.getMaps()[0];
      return renderer.map.getPaintProperty(renderer.displayed.layer,'raster-opacity')===0.45;
    });
    assert.equal(await page.locator('#opacity-label').innerText(), '45%');
    await page.locator('#opacity').evaluate(element => {element.value='82';element.dispatchEvent(new Event('input', {bubbles:true}));});
    await page.locator('#show-obs').uncheck();
    assert.equal(await page.locator('.teller-observation-marker').count(), 0);
    await page.locator('#show-obs').check();
    await page.waitForFunction(() => document.querySelectorAll('.teller-observation-marker').length>0);
    await page.locator('#show-alerts').uncheck();
    assert.equal(await page.evaluate(() => window.__tellerTest.getMaps()[0].map.getSource('alerts').serialize().data.features.length), 0);
    await page.locator('#show-alerts').check();
    assert.ok(await page.evaluate(() => window.__tellerTest.getMaps()[0].map.getSource('alerts').serialize().data.features.length)>0);
    await page.locator('#sites').selectOption('KPUX');
    await page.waitForFunction(() => Math.abs(window.__tellerTest.getMaps()[0].getView().center[0]+104.1814)<0.00001);
    assert.equal(await page.locator('.teller-site-marker').innerText(), 'KPUX');
    await page.locator('#layers-close').click();
    assert.equal(await page.locator('#layers-panel').isVisible(), false);
    await page.locator('#layers-toggle').click();
    assert.equal(await page.locator('#layers-panel').isVisible(), true);
    await page.locator('#weather-close').click();
    assert.equal(await page.locator('#weather-panel').isVisible(), false);
    await page.locator('#weather-toggle').click();
    assert.equal(await page.locator('#weather-panel').isVisible(), true);
    await page.locator('#home').click();
    const initialZoom=await page.evaluate(()=>window.__tellerTest.getMaps()[0].getView().zoom);
    await page.locator('.maplibregl-ctrl-zoom-in').first().click();
    await page.waitForFunction(zoom=>window.__tellerTest.getMaps()[0].getView().zoom>zoom+0.8,initialZoom);
    await page.locator('.maplibregl-ctrl-zoom-out').first().click();
    await page.waitForFunction(zoom=>Math.abs(window.__tellerTest.getMaps()[0].getView().zoom-zoom)<0.1,initialZoom);
    await page.evaluate(()=>{const renderer=window.__tellerTest.getMaps()[0];renderer.setView({...renderer.getView(),bearing:25});});
    await page.locator('.maplibregl-ctrl-compass').first().click();
    await page.waitForFunction(()=>Math.abs(window.__tellerTest.getMaps()[0].getView().bearing)<0.1);
  });
  await check('map point probing and saved views preserve explicit user camera choices', async () => {
    const canvas=page.locator('.maplibregl-canvas').first();
    const box=await canvas.boundingBox();
    await canvas.click({position:{x:box.width*0.7,y:box.height*0.45}});
    await page.waitForFunction(() => document.querySelector('#point-name').textContent==='Selected map point');
    assert.equal(await page.locator('#probe').isVisible(), true);
    await page.waitForFunction(() => /Synthetic fixture images are not quantitative radar observations/.test(document.querySelector('#probe').textContent));
    assert.doesNotMatch(await page.locator('#probe').innerText(), /[\d.-]+ dBZ/);
    await page.locator('#probe [aria-label="Close probe"]').click();
    assert.equal(await page.locator('#probe').isVisible(), false);
    await page.waitForFunction(() => document.querySelectorAll('.teller-point-marker').length===1);
    page.once('dialog', dialog => dialog.accept('Fixture camera'));
    await page.locator('#save-view').click();
    await page.locator('#saved-views option', {hasText:'Fixture camera'}).waitFor({state:'attached'});
    const saved=await page.evaluate(() => window.__tellerTest.getMaps()[0].getView());
    await page.locator('[data-region="national"]').click();
    await page.waitForFunction(() => window.__tellerTest.getMaps()[0].getView().zoom<5);
    await page.locator('#saved-views').selectOption({label:'Fixture camera'});
    await page.waitForFunction(expected => Math.abs(window.__tellerTest.getMaps()[0].getView().zoom-expected.zoom)<0.00001, saved);
    await page.locator('[data-region="springs"]').click();
    await page.waitForFunction(() => Math.abs(window.__tellerTest.getMaps()[0].getView().center[0]+104.8214)<0.0001);
    await page.locator('[data-region="teller"]').click();
  });
  await check('independent and linked timelines, frame buttons and loop speed work', async () => {
    await page.locator('[data-layout="2"]').click();
    await waitDisplayed(null,null,1);
    const second=await displayed(1);
    const secondCamera=await page.evaluate(()=>window.__tellerTest.getMaps()[1].getView());
    await page.locator('#link-camera').uncheck();
    await page.evaluate(()=>window.__tellerTest.getMaps()[0].setView({center:[-104.5,39.5],zoom:7.2}));
    const unchanged=await page.evaluate(()=>window.__tellerTest.getMaps()[1].getView());
    assert.deepEqual(unchanged,secondCamera);
    await page.locator('#link-camera').check();
    await page.evaluate(()=>window.__tellerTest.getMaps()[0].setView({center:[-105.08,38.98],zoom:7.4}));
    await page.waitForFunction(()=>Math.abs(window.__tellerTest.getMaps()[1].getView().center[0]+105.08)<0.00001);
    await page.locator('#link-time').uncheck();
    await setTimeline(0);
    await page.waitForFunction(() => window.__tellerTest.getMaps()[0].displayed?.frame.id!==window.__tellerTest.getMaps()[1].displayed?.frame.id);
    assert.equal((await displayed(1)).frameId, second.frameId);
    await page.locator('#link-time').check();
    await setTimeline(1);
    await page.waitForFunction(() => window.__tellerTest.getMaps()[0].displayed?.frame.id===window.__tellerTest.getMaps()[1].displayed?.frame.id);
    await page.locator('#next').click();
    await page.waitForFunction(() => document.querySelector('#timeline').value==='2');
    await page.locator('#prev').click();
    await page.waitForFunction(() => document.querySelector('#timeline').value==='1');
    await page.locator('#latest').click();
    await page.waitForFunction(() => document.querySelector('#timeline').value===document.querySelector('#timeline').max);
    await page.locator('#speed').selectOption('1000');
    assert.equal(await page.evaluate(() => window.__tellerTest.getState().settings.speed),1000);
    await page.locator('#speed').selectOption('500');
    await page.locator('[data-layout="1"]').click();
    await waitDisplayed();
  });
  await check('help, capabilities, diagnostics and forecast details expose useful source content', async () => {
    for (const [id, expected] of [['help', /Space.*play/i],['capabilities-open', /independent|verification/i],['diagnostics-toggle', /gateway|diagnostic|fixture/i]]) {
      await page.locator(`#${id}`).click();
      await page.locator('#details-dialog[open]').waitFor();
      assert.match(await page.locator('#details-content').innerText(), expected);
      await page.locator('[data-close="details-dialog"]').click();
    }
    await page.locator('#alerts').scrollIntoViewIfNeeded();
    const alert=page.locator('#alerts details').first();
    await alert.locator('summary').click();
    assert.match(await alert.locator('pre').innerText(), /synthetic|fixture/i);
    const hourly=page.locator('details.weather-section').filter({has:page.locator('summary',{hasText:'Hourly forecast'})});
    await hourly.locator('summary').click();
    assert.ok(await hourly.locator('table tr').count()>1);
    await page.locator('#weather-panel').evaluate(element => {element.scrollTop=0;});
  });
  await check('property is initially unset and exact user entry persists', async () => {
    await page.locator('#property-open').click();
    await page.locator('#property-dialog[open]').waitFor();
    assert.equal(await page.locator('[name="latitude"]').inputValue(), '');
    assert.equal(await page.locator('[name="longitude"]').inputValue(), '');
    assert.equal(await page.locator('[name="elevationFt"]').inputValue(), '9200');
    await page.locator('[name="latitude"]').fill('38.95');
    await page.locator('[name="longitude"]').fill('-105.1');
    await page.locator('[name="elevationFt"]').fill('9210');
    await page.locator('#property-form button[type="submit"]').click();
    await page.waitForFunction(() => !document.querySelector('#property-dialog').open);
    let persisted = null;
    for (let attempt = 0; attempt < 50; attempt++) {
      persisted = await (await page.request.get(`${instance.url}/api/settings`)).json();
      if (persisted.property?.latitude === 38.95 && persisted.property?.longitude === -105.1 && persisted.property?.elevationFt === 9210) break;
      await page.waitForTimeout(100);
    }
    assert.equal(persisted?.property?.elevationFt, 9210, 'Wait for the actual preferences write before testing reload');
    report.propertyPersistence = {beforeReload: persisted.property};
    const warm = performance.now();
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => window.__tellerReady?.ready === true);
    report.warmReloadToUsableFixtureMs = Math.round(performance.now() - warm);
    report.propertyPersistence.afterReload = await page.evaluate(() => window.__tellerTest.getState().settings.property);
    assert.doesNotMatch(await page.locator('.point-instruction').innerText(),/location is unset/);
    await page.locator('#property-open').click();
    assert.equal(await page.locator('[name="latitude"]').inputValue(), '38.95');
    assert.equal(await page.locator('[name="longitude"]').inputValue(), '-105.1');
    assert.equal(await page.locator('[name="elevationFt"]').inputValue(), '9210');
    await page.locator('#property-clear').click();
    await page.waitForFunction(()=>window.__tellerTest.getState().settings.property===null);
    assert.equal(await page.locator('.teller-property-marker').count(),0);
    assert.match(await page.locator('.point-instruction').innerText(),/unset/i);
  });
  await check('keyboard and map image export work', async () => {
    await page.locator('#home').click();
    const homeCamera = await page.evaluate(() => {
      const value = window.__tellerTest.getMaps()[0];
      return (value?.renderer || value?.view || value).getView();
    });
    await page.evaluate(() => {
      const value = window.__tellerTest.getMaps()[0];
      (value?.renderer || value?.view || value).setView({center: [-104, 40], zoom: 6});
    });
    await page.locator('body').click({position: {x: 900, y: 25}});
    await page.keyboard.press('h');
    await page.waitForFunction(expected => {
      const value = window.__tellerTest.getMaps()[0];
      const camera = (value?.renderer || value?.view || value).getView();
      return Math.abs(camera.center[0] - expected.center[0]) < 0.001 && Math.abs(camera.center[1] - expected.center[1]) < 0.001;
    }, homeCamera);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export').click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.png$/i);
    await download.saveAs(join(artifacts, 'fixture-export.png'));
    assert.ok((await stat(join(artifacts, 'fixture-export.png'))).size > 1000);
  });
  await page.screenshot({path: join(artifacts, 'fixture-workspace.png'), fullPage: true});
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const beforeMetrics = await cdp.send('Runtime.getHeapUsage');
  report.frameTiming = {idle: await sampleFrames(false), localFixturePan: await sampleFrames(true), note: 'Surrounding view is not fully prewarmed; this pan may load additional local fixture tiles.'};
  const afterMetrics = await cdp.send('Runtime.getHeapUsage');
  report.browserMemoryBytes = {before: beforeMetrics, after: afterMetrics};
  report.dom = await cdp.send('Memory.getDOMCounters');
  const successErrors = [...consoleErrors];
  await check('normal fixture workflow has no unhandled exceptions or console errors', async () => {
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(successErrors, []);
  });
  report.successfulWorkflowNetwork = structuredClone(network);
  await check('partial point responses preserve alerts and withhold missing-grid accumulations', async () => {
    await page.route('**/api/point?*', async route => {
      const url=new URL(route.request().url());
      const payload=fixturePoint(Number(url.searchParams.get('lat')),Number(url.searchParams.get('lon')));
      payload.grids={};payload.observations=[];payload.periods=[];payload.hourly=[];
      payload.errors=['Synthetic partial-response test: grid endpoint unavailable'];
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)});
    });
    await page.locator('#refresh').click();
    await page.waitForFunction(() => window.__tellerTest.getState().weather?.errors?.some(message=>message.includes('partial-response')));
    assert.match(await page.locator('#alerts').innerText(), /Fixture Winter Weather Advisory/);
    assert.equal(await page.locator('#accum-start').isDisabled(),true);
    assert.ok((await page.locator('#accumulations strong').allTextContents()).every(text=>text==='—'));
    assert.deepEqual(pageErrors,[]);
    await page.unroute('**/api/point?*');
    await page.waitForFunction(() => !window.__tellerTest.getState().refreshing);
    await page.locator('#refresh').click();
    await page.waitForFunction(() => Object.keys(window.__tellerTest.getState().weather?.grids||{}).length>0);
  });
  await check('reversed user accumulation windows show unavailable totals without throwing', async () => {
    await page.locator('#accum-start').scrollIntoViewIfNeeded();
    const values=await page.locator('#accum-start').evaluate(element=>[...element.options].map(option=>option.value));
    assert.ok(values.length>=3);
    await page.locator('#accum-start').selectOption(values.at(-1));
    await page.locator('#accum-end').selectOption(values[0]);
    assert.ok((await page.locator('#accumulations strong').allTextContents()).every(text=>text==='—'));
    assert.deepEqual(pageErrors,[]);
    await page.locator('#accum-start').selectOption(values[0]);
    await page.locator('#accum-end').selectOption(values.at(-1));
    await page.locator('#weather-panel').evaluate(element=>{element.scrollTop=0;});
  });
  await check('failed new-product tiles retain displayed source metadata, legend and export attribution', async () => {
    await page.locator('.pane-product').first().selectOption('fixture-radar');
    await waitDisplayed('fixture-radar');
    const before=await displayed();
    await page.route('**/api/tiles/fixture-ir/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"deliberate fixture tile outage"}'}));
    await page.locator('.pane-product').first().selectOption('fixture-ir');
    await page.waitForFunction(()=>window.__tellerTest.getState().panes[0].status?.state==='error',null,{timeout:15_000});
    assert.equal((await displayed()).productId,before.productId);
    assert.equal((await displayed()).frameId,before.frameId);
    await page.locator('#metadata-open').click();
    const metadata=await page.locator('#details-content .context-row').allTextContents();
    assert.ok(metadata.some(text=>/^Product\s*Synthetic reflectivity/.test(text)),`Expected actual displayed product in metadata: ${metadata.join(' | ')}`);
    await page.locator('[data-close="details-dialog"]').click();
    assert.match(await page.locator('.map-pane .legend').first().innerText(),/REFLECTIVITY/);
    const exportedText=await page.evaluate(()=>{
      const renderer=window.__tellerTest.getMaps()[0],texts=[];
      const original=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(text,...args){texts.push(String(text));return original.call(this,text,...args);};
      try{renderer.exportImage();}finally{CanvasRenderingContext2D.prototype.fillText=original;}
      return texts.join('\n');
    });
    assert.match(exportedText,/Synthetic reflectivity/);
    assert.doesNotMatch(exportedText,/Synthetic infrared/);
    await page.screenshot({path:join(artifacts,'fixture-retained-frame.png'),fullPage:true});
    await page.unroute('**/api/tiles/fixture-ir/**');
    await page.locator('.pane-product').first().selectOption('fixture-radar');
    await waitDisplayed('fixture-radar');
  });
  await check('network interruption shows failure without relabeling fixture as live', async () => {
    await page.route('**/api/**', route => route.abort('internetdisconnected'));
    await page.locator('#refresh').click();
    await page.waitForFunction(() => /offline|unavailable|failed|error|network|cached/i.test(document.querySelector('#source-status').innerText), null, {timeout: 15_000});
    assert.match(await page.locator('#source-status').innerText(), /fixture|synthetic|test data/i);
    await page.screenshot({path: join(artifacts, 'fixture-network-loss.png'), fullPage: true});
    await page.unroute('**/api/**');
    await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await page.waitForFunction(()=>!window.__tellerTest.getState().refreshing && !window.__tellerTest.getState().catalog.stale && !window.__tellerTest.getState().weather?.stale && !document.querySelector('#source-status').innerText.includes('SOURCE/NETWORK ERROR'));
    assert.match(await page.locator('#status-label').innerText(),/synthetic/i);
    assert.ok(await displayed());
  });
  await check('offline startup has no fabricated weather frame', async () => {
    const offlinePage = await context.newPage();
    await offlinePage.route('**/api/**', route => route.abort('internetdisconnected'));
    await offlinePage.goto(instance.url, {waitUntil: 'domcontentloaded'});
    await offlinePage.waitForFunction(() => /offline|unavailable|failed|error|network|cannot|no .*data/i.test(document.querySelector('#source-status').innerText), null, {timeout: 15_000});
    const records = await offlinePage.evaluate(() => (window.__tellerTest?.getMaps?.() || []).map(value => (value?.renderer || value?.view || value)?.displayed || null));
    assert.ok(records.every(value => value === null));
    assert.equal(await offlinePage.locator('#timeline').isDisabled(), true);
    assert.equal(await offlinePage.evaluate(() => window.__tellerReady?.ready === true), false);
    assert.doesNotMatch(await offlinePage.locator('#status-label').innerText(), /^LIVE$/i);
    await offlinePage.screenshot({path: join(artifacts, 'offline-startup.png'), fullPage: true});
    await offlinePage.close();
  });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = {message: error.message, stack: error.stack};
  try { await page?.screenshot({path: join(artifacts, 'ui-failure.png'), fullPage: true}); } catch {}
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  report.pageErrors = pageErrors;
  report.consoleErrors = consoleErrors;
  report.completedAt = new Date().toISOString();
  await writeFile(join(artifacts, 'ui-smoke.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await instance?.close();
  await rm(dataDir, {recursive: true, force: true});
}
