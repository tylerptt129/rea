const { app, BrowserWindow, dialog, Menu, powerMonitor, shell } = require('electron');
const { mkdir, writeFile } = require('node:fs/promises');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { performance } = require('node:perf_hooks');

const startedAt = performance.now();
const fixture = process.env.TELLER_FIXTURE === '1';
const acceptanceMode = process.env.TELLER_ACCEPTANCE_MODE === 'live' ? 'live' : fixture ? 'fixture' : null;
if (fixture && acceptanceMode === 'live') throw new Error('Live acceptance cannot use fixture mode.');
const smokeOutput = process.env.TELLER_SMOKE_OUTPUT;
const externalHosts = new Set(['www.weather.gov', 'weather.gov', 'api.weather.gov', 'www.noaa.gov', 'noaa.gov', 'mesonet.agron.iastate.edu', 'wsv3.com']);
const consoleErrors = [];
let gateway;
let mainWindow;
let quitting = false;
let stopped = false;
let smokeRunning = false;
let smokeExitCode = 0;
let shutdownPromise;
const preferenceFlushes = new WeakMap();
const approvedWindowCloses = new WeakSet();
const pendingWindowCloses = new WeakSet();

app.setName('Teller Tactical');
if (process.env.TELLER_TEST_USER_DATA !== undefined) {
  try {
    const directory = process.env.TELLER_TEST_USER_DATA;
    if (!acceptanceMode || !path.isAbsolute(directory)) throw new Error('TELLER_TEST_USER_DATA requires explicit fixture/live acceptance mode and an absolute isolated test directory.');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    app.setPath('userData', directory);
  } catch (error) {
    console.error(`Test profile setup failed: ${error.message}`);
    app.exit(1);
  }
}

function openOfficialLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port && externalHosts.has(url.hostname)) {
      void shell.openExternal(url.href).catch(() => {});
    }
  } catch { /* Malformed URLs are denied. */ }
}

function isLocalDocument(value) {
  try { return gateway && new URL(value).origin === new URL(gateway.url).origin; }
  catch { return false; }
}

function flushPreferences(window) {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return Promise.resolve();
  const pending = preferenceFlushes.get(window);
  if (pending) return pending;
  const flush = window.webContents.executeJavaScript('typeof window.__tellerFlushPreferences === "function" ? window.__tellerFlushPreferences() : undefined')
    .finally(() => preferenceFlushes.delete(window));
  preferenceFlushes.set(window, flush);
  return flush;
}

function preferenceFailure(error) {
  console.error(`Preferences were not saved: ${error.message}`);
  dialog.showErrorBox('Preferences could not be saved', `${error.message}\n\nTeller Tactical will remain open to preserve the current preferences. Check the writable application data directory, then retry closing the application.`);
}

async function writeSmokeReport(report) {
  if (!smokeOutput || !fixture) return;
  if (!path.isAbsolute(smokeOutput)) throw new Error('TELLER_SMOKE_OUTPUT must be an absolute JSON output path.');
  await mkdir(path.dirname(smokeOutput), { recursive: true });
  await writeFile(smokeOutput, JSON.stringify(report, null, 2) + '\n');
}

async function failStartup(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Teller Tactical could not start: ${message}`);
  try {
    await writeSmokeReport({ ok: false, phase: 'startup', message, platform: process.platform, arch: process.arch, packaged: app.isPackaged });
    await gateway?.close();
  } catch (cleanupError) { console.error(`Startup cleanup: ${cleanupError.message}`); }
  if (!smokeOutput) dialog.showErrorBox('Teller Tactical could not start', `${message}\n\nConfirm that the application bundle is complete and that its local data directory is writable. Public weather feeds do not require an API key. See docs/RELEASE.md for diagnostics.`);
  stopped = true;
  app.exit(1);
}

async function smoke(window) {
  if (!smokeOutput || !fixture || smokeRunning) return;
  smokeRunning = true;
  let observation = {};
  let lastError;
  let ok = false;
  let stableFrameKey;
  let stableSince;
  const deadline = performance.now() + 20_000;
  while (!window.isDestroyed() && performance.now() < deadline) {
    try {
      observation = await window.webContents.executeJavaScript(`(() => {
        const marker = window.__tellerReady;
        const canvases = [...document.querySelectorAll('canvas')].map(c => ({ width: c.width, height: c.height }));
        const maps = window.__tellerTest?.getMaps?.() ?? [];
        const displayedFrames = maps.map(value => {
          const renderer = value?.renderer || value?.view || value;
          return renderer?.displayed ? { id: renderer.displayed.frame.id, product: renderer.displayed.product.id } : null;
        });
        return {
          ready: marker === true || Boolean(marker && marker.ready === true),
          details: marker ?? null,
          canvases,
          displayedFrames,
          frameLabel: document.querySelector('#frame-time')?.textContent ?? '',
          pendingLabels: [...document.querySelectorAll('.pane-load')].map(element => element.textContent).filter(Boolean),
          title: document.title,
          viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
          metrics: window.__tellerMetrics ?? null
        };
      })()`);
      const frameKey = JSON.stringify(observation.displayedFrames);
      const currentReady = observation.ready && observation.canvases.some(c => c.width > 0 && c.height > 0)
        && observation.displayedFrames.length > 0 && observation.displayedFrames.every(Boolean)
        && observation.frameLabel && !/^(No |Waiting)/.test(observation.frameLabel)
        && observation.pendingLabels.length === 0;
      if (currentReady) {
        if (frameKey !== stableFrameKey) { stableFrameKey = frameKey; stableSince = performance.now(); }
        if (performance.now() - stableSince >= 600) {
          await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          ok = true;
          break;
        }
      } else { stableFrameKey = undefined; stableSince = undefined; }
    } catch (error) { lastError = error.message; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const report = {
    ok: ok && consoleErrors.length === 0,
    phase: 'render-readiness',
    dataset: 'deterministic fixture; not live weather',
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chromium: process.versions.chrome,
    mainScriptToReadyMs: Math.round(performance.now() - startedAt),
    measurementScope: 'Starts at main script execution; excludes OS process creation and is not a cold-launch measurement.',
    gpu: app.getGPUFeatureStatus(),
    processes: app.getAppMetrics().map(({ type, name, memory, cpu }) => ({ type, name, memoryKiB: memory, cpu })),
    observation,
    consoleErrors,
    ...(lastError ? { lastEvaluationError: lastError } : {}),
    ...(!ok ? { error: 'Renderer did not establish stable current weather-frame, timeline, and canvas readiness within 20 seconds.' } : {})
  };
  if (!window.isDestroyed()) {
    try {
      const screenshot = smokeOutput.replace(/\.json$/i, '') + '.png';
      const image = await window.webContents.capturePage();
      await mkdir(path.dirname(screenshot), { recursive: true });
      await writeFile(screenshot, image.toPNG());
      report.screenshot = screenshot;
    } catch (error) { report.screenshotError = error.message; report.ok = false; }
  }
  await writeSmokeReport(report);
  smokeExitCode = report.ok ? 0 : 1;
  app.quit();
}

async function createWindow() {
  const window = new BrowserWindow({
    title: 'Teller Tactical',
    width: 1500,
    height: 960,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0b1520',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      additionalArguments: [`--teller-app-version=${app.getVersion()}`, `--teller-acceptance-mode=${acceptanceMode ?? 'none'}`]
    }
  });
  mainWindow = window;
  const session = window.webContents.session;
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const protocol = new URL(details.url).protocol;
    callback({ cancel: !isLocalDocument(details.url) && protocol !== 'data:' && protocol !== 'blob:' && protocol !== 'devtools:' });
  });
  window.webContents.setWindowOpenHandler(({ url }) => { openOfficialLink(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isLocalDocument(url)) { event.preventDefault(); openOfficialLink(url); }
  });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('console-message', details => {
    const actualLevel = details.level;
    if (actualLevel === 'error' || actualLevel === 3) {
      consoleErrors.push({ message: String(details.message).slice(0, 1200), source: String(details.sourceId ?? '').slice(0, 200) });
      if (consoleErrors.length > 30) consoleErrors.shift();
    }
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    consoleErrors.push({ message: `Renderer stopped: ${details.reason}` });
    if (!smokeOutput && !quitting) dialog.showErrorBox('Teller Tactical renderer stopped', `Reason: ${details.reason}. Relaunch the application. Cached data and saved preferences are retained.`);
  });
  window.once('ready-to-show', () => window.show());
  window.on('close', event => {
    if (quitting || approvedWindowCloses.has(window)) return;
    event.preventDefault();
    if (pendingWindowCloses.has(window)) return;
    pendingWindowCloses.add(window);
    flushPreferences(window).then(() => {
      approvedWindowCloses.add(window);
      window.close();
    }).catch(preferenceFailure).finally(() => pendingWindowCloses.delete(window));
  });
  window.on('closed', () => { if (mainWindow === window) mainWindow = undefined; });
  await window.loadURL(gateway.url);
  void smoke(window).catch(failStartup);
  return window;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
    else if (app.isReady() && gateway) void createWindow().catch(failStartup);
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0 && gateway) void createWindow().catch(failStartup); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin' || smokeOutput) app.quit(); });
  app.on('before-quit', event => {
    if (stopped) return;
    event.preventDefault();
    if (shutdownPromise) return;
    quitting = true;
    shutdownPromise = (async () => {
      try {
        await Promise.all(BrowserWindow.getAllWindows().map(flushPreferences));
      } catch (error) {
        quitting = false;
        shutdownPromise = undefined;
        preferenceFailure(error);
        return;
      }
      try { await gateway?.close(); }
      catch (error) { console.error(`Local gateway shutdown: ${error.message}`); smokeExitCode = 1; }
      stopped = true;
      if (smokeOutput) app.exit(smokeExitCode); else app.quit();
    })();
  });
  app.whenReady().then(async () => {
    if (smokeOutput && (!fixture || !path.isAbsolute(smokeOutput))) throw new Error('Automated screenshot/report output requires TELLER_FIXTURE=1 and an absolute TELLER_SMOKE_OUTPUT path.');
    const { startServer } = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'index.mjs')).href);
    gateway = await startServer({ port: 0, dataDir: path.join(app.getPath('userData'), 'weather-store'), fixture });
    if (!isLocalDocument(gateway.url) || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(gateway.url).hostname)) throw new Error('The weather gateway did not bind a loopback address.');
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { role: 'fileMenu' }, { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'resetzoom' }, { role: 'zoomin' }, { role: 'zoomout' }] },
      { role: 'windowMenu' }
    ]));
    powerMonitor.on('resume', () => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('teller:resume', { at: new Date().toISOString() });
    });
    await createWindow();
  }).catch(failStartup);
}
