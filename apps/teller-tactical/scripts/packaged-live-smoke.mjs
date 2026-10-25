import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { requireLiveCatalog, requireLivePoint } from './live-smoke.mjs';
import { nativeRadarUrls } from '../server/radar-probe.mjs';

/** Structural/provenance checks stay mandatory in every acceptance phase. */
function requireNativeStructure(snapshot,{now=Date.now(),satellites=true}={}) {
  assert.equal(snapshot?.fixture,false,'Native live acceptance rejects fixture mode');
  const radar=requireLiveCatalog(snapshot.catalog);requireLivePoint(snapshot.weather);
  assert.ok(snapshot.weather.periods.some(period=>Date.parse(period.endTime)>now),'All forecast periods have expired');
  assert.ok(snapshot.weather.observations.some(observation=>{const t=Date.parse(observation.timestamp);return Number.isFinite(t)&&t<=now+60000&&t>=now-3*3600000&&!observation.stale;}),'No nearby observation meets the explicit three-hour release freshness limit');
  assert.ok(snapshot.displayed?.frameId&&snapshot.displayed.time&&snapshot.displayed.loaded&&snapshot.displayed.missingTiles===0,'Current native raster is absent, failed, or partial');
  assert.ok(snapshot.canvas?.width>0&&snapshot.canvas?.height>0,'No usable native map canvas');
  assert.ok(snapshot.frameLabel&&!/^(No |Waiting)/.test(snapshot.frameLabel),'Displayed-frame timestamp is absent');
  const required=[radar.product];
  if(satellites)for(const channel of ['GOES-East_ABI_Band13_Clean_Infrared','GOES-East_ABI_Band2_Red_Visible_1km']){
    const product=snapshot.catalog.products.find(value=>value.sourceProductId===channel);
    assert.ok(product&&product.kind==='satellite'&&!product.stale&&product.frames.length>=2,`No usable real ${channel} catalog`);
    assert.ok(product.frames.every(frame=>frame.verified),'Unverified satellite times cannot pass');required.push(product);
  }
  const sources=required.map(product=>{
    const frame=product.frames.at(-1),time=Date.parse(frame.time);
    assert.ok(Number.isFinite(time)&&time<=now+60000,'Invalid or future source frame cannot pass');
    const budgetMinutes=product.kind==='radar'?20:(product.expectedLatencyMinutes??40)+3*(product.cadenceMinutes??10);
    return {productId:product.id,sourceProductId:product.sourceProductId??null,sourceUrl:product.sourceUrl,observationTime:frame.time,retrievedAt:product.temporalMetadataRetrievedAt??product.retrievedAt??null,ageMinutes:(now-time)/60000,budgetMinutes};
  });
  return {radar,sources};
}

/** Startup must positively establish fresh real sources; budgets are unchanged. */
export function requireNativeLiveSnapshot(snapshot,options={}) {
  const {radar,sources}=requireNativeStructure(snapshot,options);
  for(const source of sources)assert.ok(source.ageMinutes<=source.budgetMinutes,`${source.productId} exceeds its freshness budget: observation=${source.observationTime}, age=${source.ageMinutes.toFixed(2)}min, budget=${source.budgetMinutes}min`);
  return radar;
}
export function createNativeStartupBaseline(snapshot,{now=Date.now()}={}) {
  requireNativeLiveSnapshot(snapshot,{now});
  return Object.freeze({kind:'verified-fresh-native-startup',checkedAt:now,sources:Object.freeze(requireNativeStructure(snapshot,{now}).sources.map(source=>Object.freeze({...source})))});
}

/** After a proven fresh startup, elapsed aging must remain visible, never retimed. */
export function requireNativeRefreshSnapshot(snapshot,baseline,{now=Date.now()}={}) {
  assert.ok(baseline?.kind==='verified-fresh-native-startup'&&Number.isFinite(baseline.checkedAt)&&Array.isArray(baseline.sources)&&baseline.sources.length>=3,'Refresh acceptance requires a verified fresh startup baseline');
  const {sources}=requireNativeStructure(snapshot,{now});
  for(const source of sources){
    const previous=baseline.sources.find(value=>value.productId===source.productId);
    assert.ok(previous&&previous.sourceProductId===source.sourceProductId&&previous.sourceUrl===source.sourceUrl,'Source identity changed after the fresh startup baseline');
    assert.ok(Date.parse(source.observationTime)>=Date.parse(previous.observationTime),'Latest advertised source time regressed after startup');
  }
  const qualityWarnings=sources.filter(source=>source.ageMinutes>source.budgetMinutes).map(source=>({...source,asOf:new Date(now).toISOString(),freshness:'aged',sourceHealth:'degraded',uiStatusLabel:snapshot.statusLabel,uiStatus:snapshot.status}));
  if(qualityWarnings.length)assert.match(snapshot.statusLabel??'',/STALE|UNAVAILABLE/,'Aged sources require an explicit visible stale/unavailable operator label; a fresh label cannot pass');
  return {sourceHealth:qualityWarnings.length?'degraded':'within-startup-budgets',qualityWarnings,sources};
}

/** Validate the source-native API, never rendered RGB colors or a decode-error fallback. */
export function requireNativeProbeSample(sample, { frame, latitude, longitude, startedAt, now = Date.now() }) {
  assert.equal(frame?.verified, true, 'Probe must bind to a source-advertised verified frame');
  const expected = nativeRadarUrls(frame, now);
  assert.equal(sample?.fixture, false, 'Native probe cannot use fixture data');
  assert.equal(sample.sourceUrl, expected.image, 'Probe source PNG does not match the selected actual frame');
  assert.equal(sample.worldfileUrl, expected.worldfile, 'Probe georeferencing does not match the selected source');
  assert.equal(Date.parse(sample.observationTime), Date.parse(frame.time), 'Probe changed the observation timestamp');
  assert.equal(sample.latitude, latitude); assert.equal(sample.longitude, longitude);
  assert.equal(sample.stale, false, 'First isolated live native probe must establish a fresh accepted source response');
  assert.ok(Number.isFinite(startedAt), 'Probe acceptance requires the current run start time');
  for (const name of ['retrievedAt', 'worldfileRetrievedAt']) {
    const time = Date.parse(sample[name]);
    assert.ok(Number.isFinite(time) && time >= startedAt - 1000 && time <= now + 60000, `${name} is not a current-run source retrieval`);
  }
  assert.equal(sample.units, 'dBZ'); assert.equal(sample.quantizationDbz, 0.5);
  const cell = sample.cell;
  assert.ok(cell && Number.isInteger(cell.width) && Number.isInteger(cell.height) && cell.width > 0 && cell.height > 0, `No admitted native raster/cell; unavailable worker/decode errors cannot pass as missing observations: ${String(sample.reason ?? '').slice(0, 350)}`);
  assert.ok(Number.isInteger(cell.column) && Number.isInteger(cell.row) && cell.column >= 0 && cell.column < cell.width && cell.row >= 0 && cell.row < cell.height, 'Probe native index is outside its admitted source raster');
  assert.equal(cell.resolution?.projection, 'EPSG:4326'); assert.equal(cell.resolution?.units, 'degrees');
  assert.match(cell.sampling ?? '', /nearest native pixel center/);
  assert.ok(cell.bounds?.west <= longitude && cell.bounds.east >= longitude && cell.bounds.south <= latitude && cell.bounds.north >= latitude, 'Returned source cell does not contain the requested known-location point');
  assert.ok(Number.isInteger(sample.nativeIndex) && sample.nativeIndex >= 0 && sample.nativeIndex <= 255, 'No accepted native index; a failed ASAR worker cannot masquerade as source missingness');
  assert.ok(Array.isArray(sample.limitations) && sample.limitations.some(note => /not raw single-site/i.test(note)), 'Quantized composite limitation is missing');
  if (sample.nativeIndex === 0) {
    assert.equal(sample.available, false); assert.equal(sample.value, null, 'Native index0 cannot become0dBZ');
    assert.match(sample.reason ?? '', /missing coverage.*no echo|no echo.*missing coverage/i, 'Index0 must retain the missing-coverage/no-echo ambiguity');
  } else {
    assert.equal(sample.available, true, 'A valid quantitative native index must not be hidden as unavailable');
    assert.equal(sample.value, sample.nativeIndex * 0.5 - 32.5, 'Quantized source value disagrees with the published N0Q native-index mapping');
    assert.match(sample.quality ?? '', /quantized native index/);
  }
  return { workerBackedNativeIndexVerified: true, liveQuantitativeValueVerified: sample.available,
    productId: 'iem-n0q', frameId: frame.id, observationTime: sample.observationTime, sourceUrl: sample.sourceUrl, worldfileUrl: sample.worldfileUrl,
    retrievedAt: sample.retrievedAt, worldfileRetrievedAt: sample.worldfileRetrievedAt, latitude, longitude,
    nativeIndex: sample.nativeIndex, available: sample.available, value: sample.value, units: sample.units, quantizationDbz: sample.quantizationDbz,
    cell: sample.cell, ...(sample.reason ? { reason: sample.reason } : {}), limitations: sample.limitations };
}

async function snapshot(page) {
  return page.evaluate(() => {
    const access = window.__tellerAcceptance;
    if (!access) return null;
    const state = access.getState();
    const map = access.getMaps()[state.active] ?? access.getMaps()[0];
    return {
      fixture: state.fixture, refreshing: state.refreshing, catalog: state.catalog, weather: state.weather,
      displayed: map?.displayed ? { frameId: map.displayed.frame.id, time: map.displayed.frame.time, productId: map.displayed.product.id, kind: map.displayed.product.kind, loaded: map.map.isSourceLoaded(map.displayed.layer), missingTiles: map.displayed.missingTiles } : null,
      canvas: map?.map ? { width: map.map.getCanvas().width, height: map.map.getCanvas().height } : null,
      frameLabel: document.querySelector('#frame-time')?.textContent ?? '',
      status: document.querySelector('#source-status')?.textContent ?? '', statusLabel: document.querySelector('#status-label')?.textContent ?? '',
      pending: [...document.querySelectorAll('.pane-load')].map(value => value.textContent).filter(Boolean)
    };
  });
}

export async function runPackagedLiveSmoke({ executable, reportPath = process.env.TELLER_PACKAGED_LIVE_REPORT, timeoutMs = 120_000 } = {}) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  executable = resolve(executable ?? (process.platform === 'darwin' ? join(root, 'release/Teller Tactical-darwin-arm64/Teller Tactical.app/Contents/MacOS/Teller Tactical') : join(root, 'release/Teller Tactical-linux-x64/Teller Tactical')));
  reportPath = resolve(reportPath ?? join(root, 'artifacts/packaged-live.json'));
  const outputDir = dirname(reportPath);
  await mkdir(outputDir, { recursive: true });
  const profile = await mkdtemp(join(outputDir, 'native-live-profile-'));
  const launchFlags = process.platform !== 'darwin' && process.env.TELLER_SOFTWARE_RENDERING === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];
  const environment = { ...process.env, TELLER_ACCEPTANCE_MODE: 'live', TELLER_TEST_USER_DATA: profile, XDG_CONFIG_HOME: profile };
  delete environment.TELLER_FIXTURE;
  delete environment.TELLER_SMOKE_OUTPUT;
  delete environment.ELECTRON_RUN_AS_NODE;
  const report = { status: 'running', fixture: false, startedAt: new Date().toISOString(), executable, profile, host: { platform: process.platform, arch: process.arch }, launchFlags, checks: [], consoleErrors: [], pageErrors: [], limitations: ['This run verifies only the reported native OS/architecture and current source data.', 'Radar remains a provider mosaic; native probes verify quantized indexed values or explicit missingness, not raw-site velocity, tracking or nowcasting.'] };
  let application, page, expectedOffline = false;
  report.expectedFaultConsoleErrors = [];
  const check = async (name, work) => { const start = performance.now(); await work(); report.checks.push({ name, status: 'passed', elapsedMs: Math.round(performance.now() - start) }); console.log(`PASS ${name}`); };
  const waitRendered = async () => {
    await page.waitForFunction(() => {
      const access = window.__tellerAcceptance;
      if (!access) return false;
      const state = access.getState();
      const map = access.getMaps()[state.active] ?? access.getMaps()[0];
      return state.fixture === false && !state.refreshing && state.weather !== null && map?.displayed && map.map.isSourceLoaded(map.displayed.layer) && !document.querySelector('.pane-load')?.textContent;
    }, null, { timeout: timeoutMs });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  try {
    await check('native packaged application launches with isolated real-data profile and default target GPU', async () => {
      const start = performance.now();
      application = await electron.launch({ executablePath: executable, cwd: root, env: environment, args: [...launchFlags, '--remote-debugging-address=127.0.0.1'], chromiumSandbox: true, timeout: 30_000 });
      page = await application.firstWindow();
      page.on('console', message => { if (message.type() !== 'error') return;const text=message.text().slice(0,1000);const location=message.location();let path=location.url;try{path=new URL(location.url).pathname;}catch{}const error={message:text,path,line:location.lineNumber};if(expectedOffline&&/ERR_INTERNET_DISCONNECTED/.test(text))report.expectedFaultConsoleErrors.push(error);else report.consoleErrors.push(error); });
      report.resourceFailures=[];page.on('response',response=>{if(response.status()>=400&&report.resourceFailures.length<40){let path=response.url();try{path=new URL(path).pathname;}catch{}report.resourceFailures.push({path,status:response.status()});}});
      page.on('pageerror', error => report.pageErrors.push(error.message));
      const runtime = await application.evaluate(({ app, BrowserWindow }) => ({ packaged: app.isPackaged, appPath: app.getAppPath(), platform: process.platform, arch: process.arch, userData: app.getPath('userData'), noSandbox: app.commandLine.hasSwitch('no-sandbox'), gpu: app.getGPUFeatureStatus(), windows: BrowserWindow.getAllWindows().map(window => { const p = window.webContents.getLastWebPreferences(); return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration }; }) }));
      assert.equal(runtime.packaged, true); assert.equal(resolve(runtime.userData), profile); assert.equal(runtime.noSandbox, false);
      assert.ok(runtime.windows.every(value => value.sandbox && value.contextIsolation && !value.nodeIntegration));
      if (process.platform === 'darwin') assert.deepEqual(launchFlags, [], 'Mac release acceptance must use its default hardware renderer');
      report.runtime = runtime;
      await waitRendered();
      report.launchToUsableMs = Math.round(performance.now() - start);
    });
    let initial, startupBaseline;report.qualityWarnings=[];report.sourceHealth='not-yet-verified';
    await check('actual recent radar, satellite and NWS data render with source provenance', async () => {
      initial = await snapshot(page); startupBaseline=createNativeStartupBaseline(initial);report.initial = initial;report.startupBaseline=startupBaseline;report.sourceHealth='fresh-startup-verified';
      await page.screenshot({ path: join(outputDir, 'packaged-live-radar.png') });
    });
    await check('packaged ASAR worker returns source-native radar indices with quantitative or explicit missing semantics', async () => {
      assert.ok(typeof report.runtime.appPath === 'string' && report.runtime.appPath.endsWith('.asar'), 'This gate must exercise the actual packaged ASAR application');
      const product = initial.catalog.products.find(value => value.id === 'iem-n0q');
      assert.ok(product, 'No supported native quantitative radar source');
      const frame = product.frames.at(-1), latitude = 38.8339, longitude = -104.8214;
      const query = new URLSearchParams({ productId: product.id, frameId: frame.id, lat: String(latitude), lon: String(longitude) }).toString();
      const fetchSample = () => page.evaluate(async query => {
        const response = await fetch(`/api/probe?${query}`, { signal: AbortSignal.timeout(65_000) });
        const sample = await response.json();
        if (!response.ok) throw new Error(`Native probe HTTP${response.status}: ${sample.error ?? 'source sample unavailable'}`);
        return sample;
      }, query);
      const first = await fetchSample();
      const context = { frame, latitude, longitude, startedAt: Date.parse(report.startedAt) };
      report.nativeProbe = { ...first, frameId: frame.id, appArchiveVerified: true, status: 'checking' };
      Object.assign(report.nativeProbe, requireNativeProbeSample(first, context));
      const repeated = requireNativeProbeSample(await fetchSample(), context);
      for (const field of ['nativeIndex', 'value', 'available', 'observationTime', 'sourceUrl', 'worldfileUrl', 'retrievedAt', 'worldfileRetrievedAt']) assert.equal(repeated[field], report.nativeProbe[field], `Repeated source-native sample changed ${field} without a new source/frame`);
      report.nativeProbe.repeatedSampleStable = true;report.nativeProbe.status = 'passed';
    });
    await check('radar frame selection and playback change accepted real frame identities', async () => {
      const before = initial.displayed.frameId;
      await page.locator('#prev').click();
      await page.waitForFunction(id => window.__tellerAcceptance.getMaps()[0].displayed?.frame.id !== id, before, { timeout: 30_000 });
      await waitRendered();
      const prior = await snapshot(page); assert.notEqual(prior.displayed.frameId, before); assert.equal(prior.displayed.missingTiles, 0);
      await page.locator('#play').click();
      await page.waitForFunction(id => window.__tellerAcceptance.getMaps()[0].displayed?.frame.id !== id, prior.displayed.frameId, { timeout: 30_000 });
      await page.locator('#play').click();
      await waitRendered(); report.radarPlayback = { initial: before, previous: prior.displayed.frameId, after: (await snapshot(page)).displayed.frameId };
    });
    await check('real visible and infrared satellite textures render, without fixture substitution', async () => {
      for (const sourceProductId of ['GOES-East_ABI_Band13_Clean_Infrared', 'GOES-East_ABI_Band2_Red_Visible_1km']) {
        const product = initial.catalog.products.find(value => value.sourceProductId === sourceProductId);
        await page.locator('.pane-product').first().selectOption(product.id);
        await page.waitForFunction(id => window.__tellerAcceptance.getMaps()[0].displayed?.product.id === id, product.id, { timeout: 40_000 });
        await waitRendered(); const rendered = await snapshot(page); assert.equal(rendered.fixture, false); assert.equal(rendered.displayed.missingTiles, 0);
        await page.screenshot({ path: join(outputDir, `packaged-live-${sourceProductId.includes('Band13') ? 'infrared' : 'visible'}.png`) });
      }
    });
    await check('source refresh preserves observations and visibly handles elapsed aging', async () => {
      const response = await page.evaluate(async () => { const r = await fetch('/api/refresh', { method: 'POST' }); if (!r.ok) throw new Error(`Refresh ${r.status}`); return r.json(); });
      requireLiveCatalog(response); assert.equal(response.fixture, false); report.refreshedCatalog = response;
      await page.locator('#refresh').click();await waitRendered();const quality=requireNativeRefreshSnapshot(await snapshot(page),startupBaseline);report.refreshQuality=quality;report.qualityWarnings.push(...quality.qualityWarnings);report.sourceHealth=quality.sourceHealth;
    });
    report.normalConsoleErrors = [...report.consoleErrors];
    assert.deepEqual(report.normalConsoleErrors, [], 'Unexpected errors occurred before deliberate network interruption');
    await check('interruption retains source/time and online recovery restores real source data', async () => {
      const before = await snapshot(page);
      expectedOffline = true;
      await page.context().setOffline(true);
      await page.locator('#refresh').click();
      await page.waitForFunction(() => window.__tellerAcceptance.getState().catalog.stale === true);
      const interrupted = await snapshot(page); assert.equal(interrupted.displayed.frameId, before.displayed.frameId); assert.equal(interrupted.fixture, false);
      await page.context().setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.waitForFunction(() => { const s = window.__tellerAcceptance.getState(); return !s.refreshing && s.catalog.stale === false; }, null, { timeout: timeoutMs });
      await waitRendered();const quality=requireNativeRefreshSnapshot(await snapshot(page),startupBaseline);report.recoveryQuality=quality;report.qualityWarnings.push(...quality.qualityWarnings);if(quality.qualityWarnings.length)report.sourceHealth='degraded';expectedOffline = false;
      report.interruption = { retainedFrame: interrupted.displayed.frameId, recovered: true };
    });
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.consoleErrors, [], 'Unexpected console errors occurred during live acceptance');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = { message: error.message, stack: error.stack }; if(report.nativeProbe?.status==='checking')report.nativeProbe.status='failed'; process.exitCode = 1;
    if (page) { try { report.failureSnapshot = await snapshot(page); await page.screenshot({ path: join(outputDir, 'packaged-live-failure.png') }); } catch {} }
  } finally {
    try { await application?.close(); } catch (error) { report.cleanupError = error.message; report.status = 'failed'; process.exitCode = 1; }
    report.completedAt = new Date().toISOString();
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`Packaged live acceptance ${report.status}: ${reportPath}`);
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runPackagedLiveSmoke({ executable: process.argv[2] });
