import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executable = resolve(process.argv[2] ?? process.env.TELLER_PACKAGED_EXECUTABLE ?? join(root, 'release/Teller Tactical-linux-x64/Teller Tactical'));
const output = resolve(process.env.TELLER_PACKAGED_REPORT ?? join(root, 'test-results/packaged-workflow.json'));
const outputDir = dirname(output);
await mkdir(outputDir, { recursive: true });
const profile = await mkdtemp(join(outputDir, 'desktop-profile-'));
const environment = { ...process.env, TELLER_FIXTURE: '1', TELLER_TEST_USER_DATA: profile, XDG_CONFIG_HOME: profile };
delete environment.TELLER_SMOKE_OUTPUT;
delete environment.ELECTRON_RUN_AS_NODE;
const renderingFlags = process.platform === 'darwin' ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const report = {
  status: 'running',
  startedAt: new Date().toISOString(),
  dataset: 'SYNTHETIC FIXTURE; does not verify live weather', fixture: true,
  executable,
  profile,
  host: { platform: process.platform, arch: process.arch },
  rendering: process.platform==='darwin'?'Native macOS default GPU; Electron sandbox enabled.':'Explicit test-only SwiftShader software ANGLE; Electron sandbox enabled.',
  launchFlags: [...renderingFlags, '--remote-debugging-address=127.0.0.1'],
  checks: [], consoleErrors: [], pageErrors: [],
  limitations: ['Instrumented test launch, not a calibrated OS cold/warm launch benchmark.', 'Synthetic fixtures do not establish live-source behavior.', 'Only this reported OS/architecture and dataset were exercised.']
};
let application;

async function check(name, operation) {
  const start = performance.now();
  await operation();
  report.checks.push({ name, status: 'passed', elapsedMs: Math.round(performance.now() - start) });
  console.log(`PASS ${name}`);
}
function listen(page) {
  page.on('console', message => {
    if (message.type() === 'error' && report.consoleErrors.length < 30) report.consoleErrors.push(message.text().slice(0, 1500));
  });
  page.on('pageerror', error => { if (report.pageErrors.length < 30) report.pageErrors.push(error.message); });
}
async function waitReady(page) {
  const ready = () => {
    const marker = window.__tellerReady;
    const maps = window.__tellerTest?.getMaps?.() ?? [];
    const label = document.querySelector('#frame-time')?.textContent ?? '';
    const pending = [...document.querySelectorAll('.pane-load')].some(element => element.textContent);
    return (marker === true || marker?.ready === true) && maps.length && maps.every(value => {
      const renderer = value?.renderer || value?.view || value;
      return Boolean(renderer?.displayed?.frame && renderer.map.getCanvas().width);
    }) && label && !/^(No |Waiting)/.test(label) && !pending;
  };
  await page.waitForFunction(ready, undefined, { timeout: 30_000 });
  await page.waitForTimeout(650);
  await page.waitForFunction(ready, undefined, { timeout: 30_000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function launch() {
  const start = performance.now();
  application = await electron.launch({ executablePath: executable, cwd: root, env: environment, args: report.launchFlags, chromiumSandbox: true, timeout: 30_000 });
  const page = await application.firstWindow();
  listen(page);
  await waitReady(page);
  const runtime = await application.evaluate(({ app, BrowserWindow }) => ({
    packaged: app.isPackaged, version: app.getVersion(), platform: process.platform, arch: process.arch,
    userData: app.getPath('userData'),
    electron: process.versions.electron, node: process.versions.node,
    sandboxDisabledByFlag: app.commandLine.hasSwitch('no-sandbox'),
    windows: BrowserWindow.getAllWindows().map(window => {
      const p = window.webContents.getLastWebPreferences();
      return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration };
    }),
    gpu: app.getGPUFeatureStatus(),
    processes: app.getAppMetrics().map(({ type, memory, cpu }) => ({ type, memoryKiB: memory, cpu }))
  }));
  assert.equal(runtime.packaged, true, 'The test must use a packaged executable');
  assert.equal(resolve(runtime.userData), resolve(profile), 'Native test must use its isolated profile on every OS');
  assert.equal(runtime.sandboxDisabledByFlag, false);
  assert.ok(runtime.windows.every(window => window.sandbox && window.contextIsolation && !window.nodeIntegration));
  return { page, runtime, launchToReadyMs: Math.round(performance.now() - start) };
}
async function settings(page) { return page.evaluate(async () => { const response = await fetch('/api/settings'); if (!response.ok) throw new Error('Settings request failed'); return response.json(); }); }
async function displayed(page) { return page.evaluate(() => window.__tellerTest.getMaps()[0].displayed.frame.id); }
async function pixels(page) { return page.evaluate(() => window.__tellerTest.getMaps()[0].map.getCanvas().toDataURL('image/png')); }

try {
  let first;
  await check('packaged native window launches with current weather frame and normal sandbox', async () => {
    first = await launch(); report.firstLaunch = { runtime: first.runtime, launchToReadyMs: first.launchToReadyMs };
    await first.page.screenshot({ path: join(outputDir, 'packaged-workflow-first.png') });
    const before = await settings(first.page); assert.ok(!before.property, 'Fresh package profile must not invent a property location');
  });
  await check('packaged frame controls change actual frame and raster pixels', async () => {
    const previous = await displayed(first.page), before = await pixels(first.page);
    await first.page.locator('#prev').click();
    await first.page.waitForFunction(id => window.__tellerTest.getMaps()[0].displayed?.frame.id !== id, previous);
    await waitReady(first.page);
    const next = await displayed(first.page), after = await pixels(first.page);
    assert.notEqual(next, previous); assert.notEqual(after, before);
    report.frameChange = { before: previous, after: next, pixelsChanged: true };
  });
  await check('packaged preferences are saved through the UI and its own gateway', async () => {
    await first.page.locator('#property-open').click();
    await first.page.locator('#property-form [name=latitude]').fill('38.95');
    await first.page.locator('#property-form [name=longitude]').fill('-105.1');
    await first.page.locator('#property-form [name=elevationFt]').fill('9210');
    await first.page.locator('#property-form button[type=submit]').click();
    await first.page.locator('#theme').click();
    await first.page.waitForFunction(async () => {
      const s = await (await fetch('/api/settings')).json();
      return s.property?.latitude === 38.95 && s.property?.longitude === -105.1 && s.property?.elevationFt === 9210 && s.theme === 'light';
    });
    report.savedPreferences = await settings(first.page);
    await first.page.locator('#opacity').evaluate(element => { element.value = '67'; element.dispatchEvent(new Event('input', { bubbles: true })); });
    report.pendingPreferenceAtQuit = { opacity: 0.67 };
    await application.close(); application = undefined;
  });
  await check('fresh packaged process restores property and theme from disk', async () => {
    const second = await launch(); report.secondLaunch = { runtime: second.runtime, launchToReadyMs: second.launchToReadyMs };
    const restored = await settings(second.page);
    assert.deepEqual(restored.property, { latitude: 38.95, longitude: -105.1, elevationFt: 9210 });
    assert.equal(restored.theme, 'light');
    assert.equal(restored.opacity, 0.67, 'Application quit must flush the latest debounced preference');
    assert.equal(await second.page.locator('html').getAttribute('data-theme'), 'light');
    assert.equal(await second.page.locator('#opacity').inputValue(), '67');
    await second.page.locator('#property-open').click();
    assert.equal(await second.page.locator('#property-form [name=latitude]').inputValue(), '38.95');
    assert.equal(await second.page.locator('#property-form [name=longitude]').inputValue(), '-105.1');
    assert.equal(await second.page.locator('#property-form [name=elevationFt]').inputValue(), '9210');
    await second.page.keyboard.press('Escape');
    await waitReady(second.page);
    await second.page.screenshot({ path: join(outputDir, 'packaged-workflow-restored.png') });
    report.restoredProperty = restored.property;
    await second.page.locator('#opacity').evaluate(element => { element.value = '73'; element.dispatchEvent(new Event('input', { bubbles: true })); });
    report.pendingPreferenceAtWindowClose = { opacity: 0.73 };
    report.windowCloseMethod = 'BrowserWindow.close() in the Electron main process, matching the native window close button';
    const closed = application.waitForEvent('close', { timeout: 15_000 });
    const nativeWindow = await application.browserWindow(second.page);
    await nativeWindow.evaluate(window => window.close());
    if (process.platform === 'darwin') await application.close();
    await closed; application = undefined;
  });
  await check('native window close flushes the latest debounced preferences before destruction', async () => {
    const third = await launch();
    const restored = await settings(third.page);
    assert.equal(restored.opacity, 0.73, 'Window close must flush the latest debounced preference');
    assert.equal(await third.page.locator('#opacity').inputValue(), '73');
    report.thirdLaunch = { runtime: third.runtime, launchToReadyMs: third.launchToReadyMs };
    await application.close(); application = undefined;
  });
  assert.deepEqual(report.consoleErrors, []);
  assert.deepEqual(report.pageErrors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = { message: error.message, stack: error.stack };
  if (application) {
    try { report.runtimeOnFailure = await application.evaluate(({app,BrowserWindow})=>({platform:process.platform,arch:process.arch,gpu:app.getGPUFeatureStatus(),windows:BrowserWindow.getAllWindows().map(w=>({destroyed:w.isDestroyed(),loading:w.webContents.isLoading(),url:w.webContents.getURL()}))})); } catch {}
    try {
      const windows = application.windows();
      if (windows.length) {
        report.failureSnapshot = await windows[0].evaluate(() => ({
          ready: window.__tellerReady ?? null,
          metrics: window.__tellerMetrics ?? null,
          frameLabel: document.querySelector('#frame-time')?.textContent,
          paneLabels: [...document.querySelectorAll('.pane-label')].map(element => element.textContent),
          displayedFrames: (window.__tellerTest?.getMaps?.() ?? []).map(value => {
            const renderer = value?.renderer || value?.view || value;
            return renderer?.displayed ? { id: renderer.displayed.frame.id, product: renderer.displayed.product.id } : null;
          })
        }));
        await windows[0].screenshot({ path: join(outputDir, 'packaged-workflow-failure.png') });
      }
    } catch {}
  }
  process.exitCode = 1;
} finally {
  try { await application?.close(); } catch (error) { report.cleanupError = error.message; process.exitCode = 1; }
  report.completedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Packaged workflow ${report.status}: ${output}`);
}
