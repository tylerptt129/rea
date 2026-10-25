import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { requireLiveCatalog, requireLivePoint } from './live-smoke.mjs';

/** Release gate: actual public data, never fixture flags or a sticky ready marker. */
export function requireNativeLiveSnapshot(snapshot, { now = Date.now(), satellites = true } = {}) {
  assert.equal(snapshot?.fixture, false, 'Native live acceptance rejects fixture mode');
  const radar = requireLiveCatalog(snapshot.catalog);
  requireLivePoint(snapshot.weather);
  assert.ok(Date.parse(radar.frames.at(-1).time) >= now - 20 * 60_000, 'Latest radar frame exceeds the explicit 20-minute release freshness limit');
  assert.ok(snapshot.weather.periods.some(period => Date.parse(period.endTime) > now), 'All forecast periods have expired');
  assert.ok(snapshot.weather.observations.some(observation => {
    const observed = Date.parse(observation.timestamp);
    return Number.isFinite(observed) && observed <= now + 60_000 && observed >= now - 3 * 3600_000 && !observation.stale;
  }), 'No nearby observation meets the explicit three-hour release freshness limit');
  assert.ok(snapshot.displayed?.frameId && snapshot.displayed.time && snapshot.displayed.loaded && snapshot.displayed.missingTiles === 0, 'Current native raster is absent, failed, or partial');
  assert.ok(snapshot.canvas?.width > 0 && snapshot.canvas?.height > 0, 'No usable native map canvas');
  assert.ok(snapshot.frameLabel && !/^(No |Waiting)/.test(snapshot.frameLabel), 'Displayed-frame timestamp is absent');
  if (satellites) {
    for (const channel of ['GOES-East_ABI_Band13_Clean_Infrared', 'GOES-East_ABI_Band2_Red_Visible_1km']) {
      const product = snapshot.catalog.products.find(value => value.sourceProductId === channel);
      assert.ok(product && product.kind === 'satellite' && !product.stale && product.frames.length >= 2, `No usable real ${channel} catalog`);
      assert.ok(product.frames.every(frame => frame.verified), 'Unverified satellite times cannot pass');
      const maxAge = ((product.expectedLatencyMinutes ?? 40) + 3 * (product.cadenceMinutes ?? 10)) * 60_000;
      assert.ok(Date.parse(product.frames.at(-1).time) >= now - maxAge, 'Satellite catalog exceeds its declared latency/cadence freshness budget');
    }
  }
  return radar;
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
      status: document.querySelector('#source-status')?.textContent ?? '',
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
  const report = { status: 'running', fixture: false, startedAt: new Date().toISOString(), executable, profile, host: { platform: process.platform, arch: process.arch }, launchFlags, checks: [], consoleErrors: [], pageErrors: [], limitations: ['This run verifies only the reported native OS/architecture and current source data.', 'Radar remains a provider mosaic; this does not validate raw-site velocity, numerical probes, tracking or nowcasting.'] };
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
      const runtime = await application.evaluate(({ app, BrowserWindow }) => ({ packaged: app.isPackaged, platform: process.platform, arch: process.arch, userData: app.getPath('userData'), noSandbox: app.commandLine.hasSwitch('no-sandbox'), gpu: app.getGPUFeatureStatus(), windows: BrowserWindow.getAllWindows().map(window => { const p = window.webContents.getLastWebPreferences(); return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration }; }) }));
      assert.equal(runtime.packaged, true); assert.equal(resolve(runtime.userData), profile); assert.equal(runtime.noSandbox, false);
      assert.ok(runtime.windows.every(value => value.sandbox && value.contextIsolation && !value.nodeIntegration));
      if (process.platform === 'darwin') assert.deepEqual(launchFlags, [], 'Mac release acceptance must use its default hardware renderer');
      report.runtime = runtime;
      await waitRendered();
      report.launchToUsableMs = Math.round(performance.now() - start);
    });
    let initial;
    await check('actual recent radar, satellite and NWS data render with source provenance', async () => {
      initial = await snapshot(page); requireNativeLiveSnapshot(initial); report.initial = initial;
      await page.screenshot({ path: join(outputDir, 'packaged-live-radar.png') });
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
    await check('real source refresh succeeds and retains observation times', async () => {
      const response = await page.evaluate(async () => { const r = await fetch('/api/refresh', { method: 'POST' }); if (!r.ok) throw new Error(`Refresh ${r.status}`); return r.json(); });
      requireLiveCatalog(response); assert.equal(response.fixture, false); report.refreshedCatalog = response;
      await page.locator('#refresh').click(); await waitRendered(); requireNativeLiveSnapshot(await snapshot(page));
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
      await waitRendered(); requireNativeLiveSnapshot(await snapshot(page)); expectedOffline = false;
      report.interruption = { retainedFrame: interrupted.displayed.frameId, recovered: true };
    });
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.consoleErrors, [], 'Unexpected console errors occurred during live acceptance');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = { message: error.message, stack: error.stack }; process.exitCode = 1;
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
