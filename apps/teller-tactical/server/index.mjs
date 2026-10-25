import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname, sep, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { WeatherClient } from './http.mjs';
import { ProductCatalog, fixturePng } from './catalog.mjs';
import { fetchPoint, fetchSites, fixturePoint, fixtureSites } from './weather.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
export function validateTile(zValue, xValue, yValue) {
  if (![zValue, xValue, yValue].every(v => /^\d+$/.test(String(v)))) throw Object.assign(new Error('Tile coordinates must be integers'), { status: 400 });
  const [z, x, y] = [zValue, xValue, yValue].map(Number);
  if (z > 14 || x >= 2 ** z || y >= 2 ** z) throw Object.assign(new Error('Tile coordinates are outside supported bounds'), { status: 400 });
  return [z, x, y];
}
function pointCoordinates(parameters) {
  const latitudeText = parameters.get('lat'), longitudeText = parameters.get('lon');
  if (latitudeText === null || longitudeText === null || !latitudeText.trim() || !longitudeText.trim())
    throw Object.assign(new Error('Provide non-empty latitude and longitude'), { status: 400 });
  const latitude = Number(latitudeText), longitude = Number(longitudeText);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
    throw Object.assign(new Error('Latitude and longitude must be finite coordinates within geographic bounds'), { status: 400 });
  return { latitude, longitude };
}
const json = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
async function bodyJson(request, limit = 32 * 1024) {
  let body = '', length = 0;
  for await (const chunk of request) { length += chunk.length; if (length > limit) throw Object.assign(new Error('Settings exceed the 32 KiB limit'), { status: 413 }); body += chunk; }
  try { const value = JSON.parse(body); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
  catch { throw Object.assign(new Error('Settings must be a JSON object'), { status: 400 }); }
}
export async function startServer({ port = 0, dataDir = process.env.TELLER_DATA_DIR ?? join(homedir(), '.teller-tactical'), fixture = process.env.TELLER_FIXTURE === '1', host = '127.0.0.1', client: suppliedClient, distDir = join(root, 'dist') } = {}) {
  if (host !== '127.0.0.1') throw new Error('The weather gateway binds only to 127.0.0.1');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const client = suppliedClient ?? new WeatherClient({ directory: join(dataDir, 'cache') });
  const catalog = new ProductCatalog(client, { fixture, statePath: join(dataDir, 'last-catalog.json') });
  const settingsPath = join(dataDir, 'settings.json');
  let settings = {};
  try { const saved = JSON.parse(await readFile(settingsPath, 'utf8')); if (saved && typeof saved === 'object' && !Array.isArray(saved)) settings = saved; } catch (error) { if (error.code !== 'ENOENT') console.error('Settings could not be read; defaults retained:', error.message); }
  let saveSettings = Promise.resolve();
  let boundPort;
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const controller = new AbortController();
    request.on('aborted', () => controller.abort(new Error('Local request cancelled')));
    response.on('close', () => { if (!response.writableEnded) controller.abort(new Error('Local response closed')); });
    try {
      const expectedHost = `127.0.0.1:${boundPort}`;
      if (request.headers.host !== expectedHost) return json(response, 403, { error: 'Unexpected Host header' });
      if (request.headers.origin && request.headers.origin !== `http://${expectedHost}`) return json(response, 403, { error: 'Cross-origin request rejected' });
      if (request.headers['sec-fetch-site'] === 'cross-site') return json(response, 403, { error: 'Cross-site request rejected' });
      const url = new URL(request.url, `http://${expectedHost}`);
      const method = request.method;
      if (!['GET', 'HEAD', 'PUT', 'POST'].includes(method)) return json(response, 405, { error: 'Method not allowed' });
      if (url.pathname === '/api/health' && method === 'GET') return json(response, 200, { ok: true, fixture, version: '0.1.0', now: new Date().toISOString() });
      if (url.pathname === '/api/catalog' && method === 'GET') return json(response, 200, await catalog.get());
      if (url.pathname === '/api/refresh' && method === 'POST') { await client.cache.expireMetadata(); return json(response, 200, await catalog.get({ force: true })); }
      if (url.pathname === '/api/diagnostics' && method === 'GET') return json(response, 200, { ...client.diagnostics(), fixture, uptimeSeconds: process.uptime(), memory: process.memoryUsage(), capabilities: { radar: 'IEM CONUS mosaic imagery', satellite: 'NASA GIBS capabilities-driven visible/IR; source availability and timestamp verification required', numericalRadarProbe: false } });
      if (url.pathname === '/api/settings' && method === 'GET') return json(response, 200, settings);
      if (url.pathname === '/api/settings' && method === 'PUT') {
        const next = await bodyJson(request);
        const persist = async () => { const temporary = `${settingsPath}.tmp`; await writeFile(temporary, JSON.stringify(next), { mode: 0o600 }); await rename(temporary, settingsPath); settings = next; };
        saveSettings = saveSettings.then(persist, persist); await saveSettings;
        return json(response, 200, { saved: true });
      }
      if (url.pathname === '/api/sites' && method === 'GET') return json(response, 200, fixture ? fixtureSites() : await fetchSites({ client, signal: controller.signal }));
      if (url.pathname === '/api/point' && method === 'GET') {
        const { latitude: lat, longitude: lon } = pointCoordinates(url.searchParams);
        return json(response, 200, fixture ? fixturePoint(lat, lon) : await fetchPoint(lat, lon, { client, signal: controller.signal }));
      }
      if (url.pathname === '/api/probe' && method === 'GET') {
        const { latitude, longitude } = pointCoordinates(url.searchParams);
        return json(response, 200, { available: false, value: null, units: null, reason: 'This provider supplies rendered raster images. Source-precision numerical values cannot be inferred reliably from image colors.', latitude, longitude });
      }
      const weatherTile = /^\/api\/tiles\/([A-Za-z0-9_-]{1,100})\/([A-Za-z0-9_-]{1,32})\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url.pathname);
      const basemap = /^\/api\/basemap\/(dark|light)\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url.pathname);
      if (method === 'GET' && (weatherTile || basemap)) {
        let result;
        if (weatherTile) {
          const [, product, frame, ...coordinates] = weatherTile;
          result = await catalog.tile(product, frame, ...validateTile(...coordinates), { signal: controller.signal });
        } else {
          const [, theme, ...coordinates] = basemap;
          const [z, x, y] = validateTile(...coordinates);
          result = fixture ? { data: fixturePng(z, x, y, 0, false, true, theme === 'light'), contentType: 'image/png', retrievedAt: new Date().toISOString(), stale: false } : await client.bytes(`https://basemaps.cartocdn.com/${theme === 'dark' ? 'dark_all' : 'light_all'}/${z}/${x}/${y}.png`, { ttl: 7 * 86400_000, signal: controller.signal, maxBytes: 2 * 1024 * 1024, image: { width: 256, height: 256 } });
        }
        if (!result.contentType.startsWith('image/')) throw new Error('Source returned a non-image tile');
        response.writeHead(200, { 'Content-Type': result.contentType, 'Content-Length': result.data.length, 'Cache-Control': result.stale ? 'no-store' : 'public, max-age=300', 'X-Teller-Stale': String(result.stale), 'X-Teller-Retrieved-At': result.retrievedAt, ...(result.observationTime ? { 'X-Teller-Observation-Time': result.observationTime } : {}) });
        return response.end(result.data);
      }
      const legend = /^\/api\/legend\/([A-Za-z0-9_-]{1,100})$/.exec(url.pathname);
      if (legend && method === 'GET') {
        const result = await catalog.legend(legend[1], { signal: controller.signal });
        response.writeHead(200, { 'Content-Type': result.contentType, 'Content-Length': result.data.length, 'Cache-Control': result.stale ? 'no-store' : 'public, max-age=3600', 'X-Teller-Stale': String(result.stale), 'X-Teller-Retrieved-At': result.retrievedAt });
        return response.end(result.data);
      }
      if (url.pathname.startsWith('/api/')) return json(response, 404, { error: 'API route not found' });
      if (method !== 'GET' && method !== 'HEAD') return json(response, 405, { error: 'Method not allowed' });
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { return json(response, 400, { error: 'Invalid path' }); }
      const path = resolve(distDir, pathname === '/' ? 'index.html' : `.${pathname}`);
      if (!path.startsWith(resolve(distDir) + sep)) return json(response, 403, { error: 'Invalid path' });
      try {
        const content = await readFile(path);
        response.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': extname(path) === '.html' ? 'no-store' : 'public,max-age=3600' });
        response.end(method === 'HEAD' ? undefined : content);
      } catch (error) {
        if (error.code === 'ENOENT') return json(response, 404, { error: 'Application asset unavailable. Run npm run build first.' });
        throw error;
      }
    } catch (error) {
      if (!response.destroyed && !response.headersSent) json(response, error.status ?? 502, { error: error.message || 'Weather source unavailable' });
    }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { boundPort = server.address().port; server.removeListener('error', reject); resolve(); }); });
  return { server, port: boundPort, url: `http://127.0.0.1:${boundPort}`, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await client.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const instance = await startServer({ port: Number(process.env.PORT ?? 4173) });
  console.log(`Teller Tactical ${process.env.TELLER_FIXTURE === '1' ? '(SYNTHETIC FIXTURE)' : '(public data)'}: ${instance.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => instance.close().then(() => process.exit(0)));
}
