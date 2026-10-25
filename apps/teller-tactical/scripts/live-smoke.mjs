#!/usr/bin/env node
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { startServer } from '../server/index.mjs';
import { WeatherClient } from '../server/http.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POINT = { latitude: 38.8339, longitude: -104.8214, name: 'Colorado Springs public reference point; not the user\'s property' };
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const error = (code, message) => Object.assign(new Error(message), { code });
const requireThat = (condition, code, message) => { if (!condition) throw error(code, message); };
const date = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const sourceUrl = (value, hostname) => {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === hostname && !url.username && !url.password; }
  catch { return false; }
};

/** Live checks require positive source provenance, not a false-ish fixture flag. */
export function requireLiveCatalog(catalog) {
  requireThat(catalog?.fixture === false, 'FIXTURE_CATALOG_REJECTED', 'Live validation requires catalog.fixture === false. Synthetic or unmarked catalogs cannot pass.');
  requireThat(catalog.stale !== true, 'STALE_CATALOG_REJECTED', 'The catalog is a stale fallback, not a successful live refresh.');
  requireThat(Array.isArray(catalog.products) && catalog.products.length > 0, 'RADAR_CATALOG_UNAVAILABLE', 'No actual source products were discovered. Check source/network errors; an empty catalog does not pass.');
  const candidates = catalog.products.filter((product) => product.kind === 'radar' && product.fixture !== true && sourceUrl(product.sourceUrl, 'mesonet.agron.iastate.edu'));
  requireThat(candidates.length > 0, 'REAL_RADAR_PRODUCT_UNAVAILABLE', 'The live catalog contains no supported radar product with IEM source provenance.');
  for (const product of candidates) {
    if (product.stale === true || !Array.isArray(product.frames)) continue;
    const frames = product.frames.filter((frame) => frame?.verified === true && typeof frame.id === 'string' && date(frame.time));
    const distinct = new Map(frames.map((frame) => [Date.parse(frame.time), frame]));
    if (distinct.size < 2) continue;
    const ordered = [...distinct.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const latest = ordered.at(-1);
    const previous = ordered.at(-2);
    requireThat(Date.parse(latest.time) <= Date.now() + 60_000, 'FUTURE_RADAR_FRAME', 'A source frame is in the future beyond clock tolerance.');
    return { product, frames: [previous, latest] };
  }
  throw error('TWO_VERIFIED_RADAR_FRAMES_UNAVAILABLE', 'At least two distinct source-verified radar frame times are required. Unverified fixture frames and stale fallbacks cannot pass.');
}

export function coordinateTile(longitude, latitude, z = 6) {
  requireThat(Number.isInteger(z) && z >= 0 && z <= 14 && Number.isFinite(longitude) && longitude >= -180 && longitude < 180 && Number.isFinite(latitude) && Math.abs(latitude) <= 85.0511287798066, 'INVALID_TILE_POINT', 'Point is outside Web Mercator tile coverage.');
  const n = 2 ** z;
  const radians = latitude * Math.PI / 180;
  return { z, x: Math.floor((longitude + 180) / 360 * n), y: Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * n) };
}

/** Validate actual PNG framing. Pixel colors are not treated as radar values. */
export function inspectPng(input) {
  const data = Buffer.from(input);
  requireThat(data.length >= 45 && data.subarray(0, 8).equals(PNG), 'RADAR_TILE_NOT_PNG', 'Radar response does not contain a PNG signature and complete header.');
  let offset = 8, header, imageChunks = 0, ended = false;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    requireThat(length <= 2 * 1024 * 1024 && offset + length + 12 <= data.length, 'TRUNCATED_RADAR_PNG', 'Radar PNG contains an incomplete or oversized chunk.');
    if (!header) {
      requireThat(type === 'IHDR' && length === 13, 'RADAR_PNG_HEADER_INVALID', 'PNG must begin with a standard IHDR.');
      header = { width: data.readUInt32BE(offset + 8), height: data.readUInt32BE(offset + 12), bitDepth: data[offset + 16], colorType: data[offset + 17] };
      requireThat(header.width === 256 && header.height === 256, 'RADAR_TILE_DIMENSIONS_INVALID', 'The requested 256×256 map tile has unexpected dimensions.');
    }
    if (type === 'IDAT') imageChunks++;
    offset += length + 12;
    if (type === 'IEND') { ended = true; break; }
  }
  requireThat(ended && imageChunks > 0 && offset === data.length, 'TRUNCATED_RADAR_PNG', 'Radar PNG is missing image data or its final chunk.');
  return { ...header, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), opacity: 'Not decoded. An empty/transparent IEM radar tile cannot distinguish no echo from missing coverage.' };
}

export function requireLivePoint(point) {
  requireThat(point?.fixture === false, 'FIXTURE_POINT_REJECTED', 'Point weather must explicitly identify itself as non-fixture data.');
  requireThat(point.stale !== true, 'STALE_POINT_REJECTED', 'Point weather is a stale fallback, not a successful live refresh.');
  requireThat(Array.isArray(point.periods) && point.periods.length > 0, 'NWS_FORECAST_UNAVAILABLE', 'NWS returned no forecast periods.');
  requireThat(point.periods.every((period) => date(period.startTime) && date(period.endTime) && Date.parse(period.endTime) > Date.parse(period.startTime)), 'NWS_FORECAST_INTERVAL_INVALID', 'Forecast periods have missing/invalid start and end times.');
  requireThat(Array.isArray(point.observations) && point.observations.some((observation) => date(observation.timestamp) && observation.stale !== true && sourceUrl(observation.sourceUrl, 'api.weather.gov')), 'NWS_OBSERVATIONS_UNAVAILABLE', 'No actual timestamped nearby NWS observation was retrieved.');
  requireThat(Array.isArray(point.alerts) && point.alertStatus && typeof point.alertStatus === 'object', 'NWS_ALERT_METADATA_UNAVAILABLE', 'Official alert response/expiration metadata is unavailable.');
  const alerts = Array.isArray(point.sources) ? point.sources.find((source) => source.name === 'alerts') : null;
  requireThat(alerts && sourceUrl(alerts.sourceUrl, 'api.weather.gov') && date(alerts.retrievedAt) && alerts.stale !== true, 'NWS_ALERT_SOURCE_UNAVAILABLE', 'The alerts request did not establish a fresh official source response. Zero alerts are valid; failed retrieval is not.');
  return point;
}

async function requestJson(base, path) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(95_000) });
  requireThat(response.ok, 'LOCAL_API_ERROR', `Local API ${path.split('?')[0]} returned HTTP ${response.status}.`);
  return response.json();
}

/** Run only on request or after a meaningful network-policy/source change. */
export async function runLiveSmoke({ reportPath = join(root, 'artifacts', 'live-smoke.json') } = {}) {
  const report = {
    startedAt: new Date().toISOString(), finishedAt: null, status: 'failed', fixture: false,
    scope: 'Fresh local gateway, two source-verified radar times and PNG requests, NWS forecast/observations/official alert metadata. Does not verify satellite, UI playback, macOS, or packaged-app behavior.',
    point: POINT, checks: [], sourceErrors: [], performance: {}, limitations: [
      'Nominal IEM mosaic times are not individual radar sweep times; contributing inputs may be older.',
      'Raster registration/pixel PNG validation does not prove source-precision numerical probing.',
      'No Mac hardware, satellite animation, low-latency guarantee, or forecast accuracy claim follows from this test.',
    ],
  };
  const started = performance.now();
  let instance, directory;
  const check = async (name, task) => {
    const start = performance.now();
    try { const evidence = await task(); report.checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - start), evidence }); return true; }
    catch (cause) { report.checks.push({ name, status: 'failed', durationMs: Math.round(performance.now() - start), code: cause.code ?? 'LIVE_CHECK_FAILED', message: String(cause.message).slice(0, 500) }); return false; }
  };
  try {
    directory = await mkdtemp(join(tmpdir(), 'teller-live-smoke-'));
    const client = new WeatherClient({ directory: join(directory, 'cache'), attempts: 1, timeoutMs: 25_000, maxConcurrent: 4 });
    // Explicit false overrides inherited TELLER_FIXTURE=1. This run never reuses a
    // user's caches or previously retained data, and never fabricates a fallback.
    instance = await startServer({ port: 0, dataDir: directory, fixture: false, client });
    await check('gateway-live-mode', async () => {
      const health = await requestJson(instance.url, '/api/health');
      requireThat(health.ok === true && health.fixture === false, 'FIXTURE_GATEWAY_REJECTED', 'Gateway failed to confirm fixture:false.');
      return { fixture: health.fixture, version: health.version };
    });
    await Promise.all([
      check('radar-catalog-and-tiles', async () => {
        const catalog = await requestJson(instance.url, '/api/catalog');
        report.sourceErrors.push(...(catalog.errors ?? []).map(({ source, message }) => ({ source, message })));
        const { product, frames } = requireLiveCatalog(catalog);
        const tile = coordinateTile(POINT.longitude, POINT.latitude);
        const images = [];
        for (const frame of frames) {
          const path = `/api/tiles/${encodeURIComponent(product.id)}/${encodeURIComponent(frame.id)}/${tile.z}/${tile.x}/${tile.y}.png`;
          const response = await fetch(instance.url + path, { signal: AbortSignal.timeout(40_000) });
          requireThat(response.ok, 'RADAR_TILE_UNAVAILABLE', `Radar frame ${frame.time} tile retrieval returned HTTP ${response.status}.`);
          requireThat(response.headers.get('content-type')?.split(';')[0] === 'image/png', 'RADAR_TILE_CONTENT_TYPE', 'Radar tile is not served as image/png.');
          requireThat(response.headers.get('x-teller-stale') === 'false', 'STALE_RADAR_TILE_REJECTED', 'Radar tile is a stale fallback.');
          const observationTime = response.headers.get('x-teller-observation-time');
          requireThat(date(observationTime) && Date.parse(observationTime) === Date.parse(frame.time), 'RADAR_TILE_TIME_MISMATCH', 'Tile request metadata does not identify the selected source frame.');
          images.push({ frameTime: frame.time, retrievedAt: response.headers.get('x-teller-retrieved-at'), ...inspectPng(new Uint8Array(await response.arrayBuffer())) });
        }
        return { product: product.id, source: product.source, sourceUrl: product.sourceUrl, projection: product.projection, frameAgeMinutes: Math.round((Date.now() - Date.parse(frames.at(-1).time)) / 6000) / 10, tile, images };
      }),
      check('nws-point-weather', async () => {
        const point = await requestJson(instance.url, `/api/point?lat=${POINT.latitude}&lon=${POINT.longitude}`);
        report.sourceErrors.push(...(point.errors ?? []).map((message) => ({ source: 'NWS point', message })));
        requireLivePoint(point);
        return { forecastPeriods: point.periods.length, forecastUpdated: point.forecastUpdated, forecastSource: point.forecastSource, observations: point.observations.map(({ stationId, timestamp, retrievedAt, sourceUrl, stale }) => ({ stationId, timestamp, retrievedAt, sourceUrl, stale })), alerts: point.alerts.length, alertStatus: point.alertStatus, sources: point.sources };
      }),
    ]);
    report.diagnostics = await requestJson(instance.url, '/api/diagnostics');
    report.status = report.checks.every((item) => item.status === 'passed') ? 'passed' : 'failed';
    const messages = JSON.stringify([report.sourceErrors, report.diagnostics?.errors]);
    if (report.status === 'failed' && /403|Forbidden|proxy|tunnel|fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|certificate|timed out/i.test(messages)) {
      report.status = 'blocked';
      report.blocker = 'One or more required live sources could not be retrieved. Inspect per-source errors and environment domain policy; there is no fixture fallback. This report does not establish the root cause of a generic fetch failure.';
    }
  } catch (cause) {
    report.checks.push({ name: 'live-run', status: 'failed', code: cause.code ?? 'LIVE_RUN_FAILED', message: String(cause.message).slice(0, 500) });
    if (['EACCES', 'EPERM'].includes(cause.code)) { report.status = 'blocked'; report.blocker = 'The execution environment prevented the local validation service from starting.'; }
  } finally {
    try { await instance?.close(); } catch (cause) { report.status = 'failed'; report.checks.push({ name: 'cleanup', status: 'failed', code: 'GATEWAY_CLEANUP_FAILED', message: String(cause.message).slice(0, 300) }); }
    if (directory) await rm(directory, { recursive: true, force: true });
    report.finishedAt = new Date().toISOString();
    report.performance.totalMs = Math.round(performance.now() - started);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(`${reportPath}.tmp`, JSON.stringify(report, null, 2) + '\n');
    await rename(`${reportPath}.tmp`, reportPath);
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runLiveSmoke();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
