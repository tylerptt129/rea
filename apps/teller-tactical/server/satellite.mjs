import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { parseDuration } from '../src/domain.mjs';

export const GIBS_CAPABILITIES = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities';
const GIBS_ORIGIN = 'https://gibs.earthdata.nasa.gov';
const WORLD_HALF = 20037508.342789244;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/;
const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = value => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : typeof value?.['#text'] === 'string' ? value['#text'] : '';
const identifier = value => text(value?.Identifier);
const frameId = time => time.replace(/[-:TZ.]/g, '').slice(0, 14);
const known = new Map([
  ['GOES-East_ABI_Band13_Clean_Infrared', { name: 'GOES East ABI C13 • Clean infrared', deliveredResolutionKm: 2, channel: 'C13, 10.3 µm', daylightOnly: false }],
  ['GOES-East_ABI_Band2_Red_Visible_1km', { name: 'GOES East ABI C02 • Visible', deliveredResolutionKm: 1, channel: 'C02, 0.64 µm', daylightOnly: true }],
]);

export function safeGibsUrl(value, { template = false } = {}) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid GIBS resource URL');
  const parsed = new URL(value);
  if (parsed.origin !== GIBS_ORIGIN || parsed.username || parsed.password || parsed.hash) throw new Error('GIBS resource points outside the verified provider host');
  if (!template && /[{}]/.test(value)) throw new Error('Unresolved GIBS resource placeholder');
  return value;
}

/** A day-range/default/current flag does not authenticate subdaily scans. */
export function observationFrames(dimension, { now = Date.now(), maxFrames = 18 } = {}) {
  const values = list(dimension?.Value).flatMap(value => text(value).split(',')).map(v => v.trim());
  const times = new Set();
  let mode = 'explicit-observation-times';
  for (const value of values) {
    if (ISO.test(value)) {
      const instant = Date.parse(value);
      if (Number.isFinite(instant) && instant <= now && instant > now - 24 * 3600_000) times.add(instant);
      continue;
    }
    const interval = value.split('/');
    if (interval.length !== 3 || !ISO.test(interval[0]) || !ISO.test(interval[1]) || interval[2] !== 'PT10M') continue;
    const start = Date.parse(interval[0]), end = Date.parse(interval[1]);
    // Accept only an explicit recent source-published rolling time window. Static
    // annual ranges, date-only bounds, and future endpoints are not scan evidence.
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end > now || end < now - 6 * 3600_000 || end - start > 48 * 3600_000 || (end - start) % 600_000 !== 0) continue;
    mode = 'source-published-bounded-10-minute-window';
    for (let instant = Math.max(start, end - (maxFrames - 1) * 600_000); instant <= end; instant += 600_000) times.add(instant);
  }
  const frames = [...times].sort((a, b) => a - b).slice(-maxFrames).map(instant => ({ id: frameId(new Date(instant).toISOString()), time: new Date(instant).toISOString(), verified: true, availability: mode }));
  return frames;
}

/** Only exact, square, globally aligned EPSG:3857 XYZ grids can go to MapLibre. */
export function webMercatorMatrices(matrixSet) {
  const crs = text(matrixSet?.SupportedCRS);
  if (!/(?:EPSG(?::|::|\/0\/|\/)[^\s]*3857|EPSG:3857)$/i.test(crs)) return null;
  const matrices = {};
  for (const matrix of list(matrixSet.TileMatrix)) {
    const width = Number(matrix.MatrixWidth), height = Number(matrix.MatrixHeight);
    const zoom = Math.log2(width), tileWidth = Number(matrix.TileWidth), tileHeight = Number(matrix.TileHeight);
    const topLeft = text(matrix.TopLeftCorner).trim().split(/\s+/).map(Number);
    const scale = Number(matrix.ScaleDenominator);
    const expectedScale = 2 * WORLD_HALF / (256 * width * 0.00028);
    if (!Number.isInteger(zoom) || zoom < 0 || zoom > 22 || width !== height || tileWidth !== 256 || tileHeight !== 256 || topLeft.length !== 2 || Math.abs(topLeft[0] + WORLD_HALF) > 1 || Math.abs(topLeft[1] - WORLD_HALF) > 1 || !Number.isFinite(scale) || Math.abs(scale / expectedScale - 1) > 0.00001 || !identifier(matrix)) continue;
    matrices[zoom] = { id: identifier(matrix), width, height, resolutionMAtEquator: scale * 0.00028 };
  }
  return Object.keys(matrices).length ? matrices : null;
}

function timeDimension(layer) { return list(layer.Dimension).find(dimension => identifier(dimension).toLowerCase() === 'time'); }
function satelliteDefinition(layer) {
  const id = identifier(layer);
  if (known.has(id)) return known.get(id);
  // Do not guess a water-vapor layer ID. Require both provider identifier and
  // provider title to explicitly identify this channel/meaning in capabilities.
  const title = text(layer.Title);
  if (/^GOES-East_ABI_Band(?:8|9|10)_/.test(id) && /water[ -]?vapou?r/i.test(title)) return { name: title, deliveredResolutionKm: null, channel: id.match(/Band(\d+)/)?.[1] ? `ABI band ${id.match(/Band(\d+)/)[1]}` : null, daylightOnly: false };
  return null;
}

function readXml(xml) {
  if (typeof xml !== 'string' || XMLValidator.validate(xml) !== true) throw new Error('NASA GIBS returned malformed XML metadata');
  return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, processEntities: false, parseTagValue: false }).parse(xml);
}
function sourceInstant(value) {
  if (!ISO.test(value)) return NaN;
  const instant = Date.parse(value);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 16) === value.slice(0, 16) ? instant : NaN;
}
const isoSeconds = value => new Date(Math.floor(value / 1000) * 1000).toISOString().replace('.000Z', 'Z');

/** NASA Worldview's official DescribeDomains contract, not a nominal WMTS calendar. */
export function describeDomainsUrl(layerId, { start, end } = {}) {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(layerId) || !Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 24 * 3600_000) throw new Error('Invalid bounded satellite metadata request');
  return `${GIBS_ORIGIN}/wmts/epsg4326/best/1.0.0/${layerId}/default/250m/all/${isoSeconds(start)}--${isoSeconds(end)}.xml`;
}

export function parseDescribeDomains(xml, { start, end, now = Date.now(), maxFrames = 18 } = {}) {
  if (![start, end, now].every(Number.isFinite) || start >= end || maxFrames < 1 || maxFrames > 100) throw new Error('Invalid satellite observation window');
  const document = readXml(xml);
  const dimension = list(document.Domains?.DimensionDomain)[0];
  if (!dimension) throw new Error('NASA GIBS did not return DescribeDomains time metadata');
  const tokens = list(dimension.Domain).flatMap(value => text(value).split(',')).map(value => value.trim()).filter(Boolean);
  if (tokens.length > 10_000) throw new Error('Satellite time-domain response exceeds the range budget');
  const times = new Set();
  const add = time => { if (Number.isFinite(time) && time >= start && time <= end && time <= now) times.add(time); };
  for (const token of tokens) {
    if (ISO.test(token)) { add(sourceInstant(token)); continue; }
    const [first, last, period, extra] = token.split('/');
    const firstTime = sourceInstant(first ?? ''), lastTime = sourceInstant(last ?? '');
    const step = parseDuration(period);
    // These are source-described ranges of actual subdaily availability. Clip
    // their source-anchored grid to the requested window, never to a guessed
    // latest scan or a wall-clock-derived nominal frame sequence.
    if (extra !== undefined || !Number.isFinite(firstTime) || !Number.isFinite(lastTime) || firstTime > lastTime || lastTime > now || !Number.isFinite(step) || step < 60_000 || step > 3600_000) continue;
    const lastIndex = Math.floor((Math.min(lastTime, end, now) - firstTime) / step);
    const firstIndex = Math.max(0, Math.ceil((start - firstTime) / step), lastIndex - maxFrames + 1);
    for (let index = firstIndex; index <= lastIndex; index++) add(firstTime + index * step);
  }
  const frames = [...times].sort((a, b) => a - b).slice(-maxFrames).map(instant => ({ id: frameId(new Date(instant).toISOString()), time: new Date(instant).toISOString(), verified: true, availability: 'provider-described-observation-times' }));
  return { frames, nextPage: text(dimension.NextPage).replace(/&amp;/g, '&') || null };
}

export async function discoverDomainFrames(client, layerId, { now = Date.now() } = {}) {
  // Bucket only the query for cache reuse. Available frame times come solely
  // from the source Domain records returned for this bounded request.
  const end = Math.floor(now / 300_000) * 300_000, start = end - 4 * 3600_000;
  const firstUrl = describeDomainsUrl(layerId, { start, end });
  let url = firstUrl, stale = false, retrievedAt = null;
  const frames = new Map(), seen = new Set();
  const prefix = new URL(firstUrl).pathname.split('/all/')[0] + '/all/';
  for (let page = 0; page < 4; page++) {
    if (seen.has(url)) throw new Error('Satellite time-domain pagination repeated a page');
    seen.add(url);
    const response = await client.bytes(url, { ttl: 60_000, maxBytes: 2 * 1024 * 1024, category: 'metadata', format: 'xml' });
    const described = parseDescribeDomains(response.data.toString('utf8'), { start, end, now });
    for (const frame of described.frames) frames.set(frame.time, frame);
    stale ||= response.stale === true;
    retrievedAt = response.retrievedAt ?? retrievedAt;
    if (!described.nextPage) return { frames: [...frames.values()].sort((a, b) => a.time.localeCompare(b.time)).slice(-18), sourceUrl: firstUrl, retrievedAt, stale };
    const next = new URL(described.nextPage, url);
    safeGibsUrl(next.href);
    if (!next.pathname.startsWith(prefix)) throw new Error('Satellite time-domain pagination changed layer or request service');
    url = next.href;
  }
  throw new Error('Satellite time-domain pagination exceeded its four-page budget');
}

export function parseGibsCapabilities(xml, options = {}) {
  const document = readXml(xml);
  const contents = document.Capabilities?.Contents;
  if (!contents) throw new Error('NASA GIBS did not return valid WMTS capabilities');
  return projectCapabilities(contents, options);
}

function projectCapabilities(contents, { now = Date.now(), retrievedAt = new Date(now).toISOString(), stale = false, domains = new Map() } = {}) {
  const sets = new Map(list(contents.TileMatrixSet).map(set => [identifier(set), set]));
  const products = [], errors = [];
  for (const layer of list(contents.Layer)) {
    const definition = satelliteDefinition(layer);
    if (!definition) continue;
    const layerId = identifier(layer);
    const fail = message => errors.push({ source: `NASA GIBS ${layerId}`, message });
    const domain = domains.get(layerId);
    const frames = domain?.frames ?? observationFrames(timeDimension(layer), { now });
    if (!frames.length) { fail(domain?.error ?? 'Capabilities do not establish recent subdaily observation times. Calendar ranges/default dates are not used as scan availability.'); continue; }
    let link, matrices;
    for (const candidate of list(layer.TileMatrixSetLink)) {
      const set = sets.get(text(candidate.TileMatrixSet));
      const validated = webMercatorMatrices(set);
      if (validated) { link = candidate; matrices = validated; break; }
    }
    if (!matrices) { fail('No georeferenced 256-pixel EPSG:3857 XYZ matrix is advertised; no approximate geographic reprojection is used.'); continue; }
    const limits = list(link.TileMatrixSetLimits?.TileMatrixLimits);
    for (const [zoom, matrix] of Object.entries(matrices)) {
      const limit = limits.find(candidate => text(candidate.TileMatrix) === matrix.id);
      if (limit) matrix.limits = { minRow: Number(limit.MinTileRow), maxRow: Number(limit.MaxTileRow), minCol: Number(limit.MinTileCol), maxCol: Number(limit.MaxTileCol) };
    }
    const resource = list(layer.ResourceURL).find(r => r['@_resourceType'] === 'tile' && ['image/png', 'image/jpeg'].includes(r['@_format']));
    if (!resource) { fail('No supported provider tile resource template is advertised.'); continue; }
    const template = resource['@_template'];
    try { safeGibsUrl(template, { template: true }); }
    catch (error) { fail(error.message); continue; }
    const placeholders = [...template.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
    if (!['Time','TileMatrix','TileRow','TileCol'].every(name => placeholders.includes(name)) || placeholders.some(name => !['Time','TileMatrixSet','TileMatrix','TileRow','TileCol','Style'].includes(name))) { fail('Provider resource template has unsupported or missing dimensions.'); continue; }
    const style = list(layer.Style).find(s => s['@_isDefault'] === 'true' || s['@_isDefault'] === true) ?? list(layer.Style)[0];
    if (!style || !identifier(style)) { fail('Provider omitted its default tile style.'); continue; }
    let legendRemote;
    const legendCandidate = list(style.LegendURL).find(value => ['image/png','image/jpeg'].includes(value['@_format']))?.['@_href'];
    if (legendCandidate) { try { legendRemote = safeGibsUrl(legendCandidate); } catch { /* Untrusted legend omitted. */ } }
    const id = `gibs-${layerId.replace(/[^A-Za-z0-9_-]/g,'-').toLowerCase()}`;
    products.push({
      id, name: definition.name, kind: 'satellite', source: 'NASA GIBS / NOAA GOES ABI', sourceUrl: 'https://www.earthdata.nasa.gov/eosdis/science-system-description/eosdis-standard-products/global-imagery-browse-services',
      sourceProductId: layerId, units: null, projection: 'EPSG:3857', cadenceMinutes: 10, expectedLatencyMinutes: 40,
      frames: frames.map(frame => ({ ...frame, retrievedAt: domain?.retrievedAt ?? retrievedAt })), retrievedAt, stale: stale || domain?.stale === true,
      ...(domain?.sourceUrl ? { temporalMetadataUrl: domain.sourceUrl, temporalMetadataRetrievedAt: domain.retrievedAt } : {}),
      coverage: 'Provider-published GOES East coverage; transparent pixels may mean missing data or outside coverage',
      numericalProbe: false, channel: definition.channel, deliveredResolutionKm: definition.deliveredResolutionKm,
      minZoom: Math.min(...Object.keys(matrices).map(Number)), maxZoom: Math.max(...Object.keys(matrices).map(Number)),
      notes: ['NASA documents approximately 40-minute latency; this is not a low-latency tactical feed.', 'Rendered browse imagery; calibrated source-precision numerical probing is unavailable.', ...(definition.daylightOnly ? ['Visible imagery depends on daylight and illumination.'] : []), 'A metadata-listed frame may still fail image retrieval; availability and loaded tiles are tracked separately.'],
      ...(legendRemote ? { legendUrl: `/api/legend/${id}`, legendRemote } : {}),
      wmts: { template, matrixSet: text(link.TileMatrixSet), style: identifier(style), format: resource['@_format'], matrices },
    });
  }
  if (!products.length && !errors.length) errors.push({ source: 'NASA GIBS satellite', message: 'Capabilities do not advertise the documented GOES East visible/infrared products.' });
  return { products, errors };
}

export async function discoverSatellite(client, { now = Date.now() } = {}) {
  const response = await client.bytes(GIBS_CAPABILITIES, { ttl: 300_000, maxBytes: 12 * 1024 * 1024, category: 'metadata', format: 'xml' });
  const document = readXml(response.data.toString('utf8'));
  const contents = document.Capabilities?.Contents;
  if (!contents) throw new Error('NASA GIBS did not return valid WMTS capabilities');
  const domains = new Map();
  const candidates = list(contents.Layer).filter(layer => satelliteDefinition(layer) && !observationFrames(timeDimension(layer), { now }).length);
  await Promise.all(candidates.map(async layer => {
    const layerId = identifier(layer);
    try { domains.set(layerId, await discoverDomainFrames(client, layerId, { now })); }
    catch (error) { domains.set(layerId, { frames: [], error: `Actual subdaily availability metadata is unavailable: ${error.message}` }); }
  }));
  const parsed = projectCapabilities(contents, { now, retrievedAt: response.retrievedAt, stale: response.stale, domains });
  return { ...parsed, retrievedAt: response.retrievedAt, stale: response.stale || parsed.products.some(product => product.stale) };
}

export function satelliteTileUrl(product, frame, z, x, y) {
  if (!product?.wmts || !product.frames?.some(candidate => candidate.id === frame.id && candidate.time === frame.time)) throw Object.assign(new Error('Unknown satellite product/frame'), { status: 404 });
  const matrix = product.wmts.matrices[z];
  if (!matrix) throw Object.assign(new Error('Satellite source does not advertise this zoom level'), { status: 422 });
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= matrix.width || y >= matrix.height) throw Object.assign(new Error('Satellite tile is outside source coverage'), { status: 404 });
  const limits = matrix.limits;
  if (limits && (x < limits.minCol || x > limits.maxCol || y < limits.minRow || y > limits.maxRow)) throw Object.assign(new Error('Satellite tile is outside advertised coverage'), { status: 404 });
  const substitutions = { Time: frame.time, TileMatrixSet: product.wmts.matrixSet, TileMatrix: matrix.id, TileRow: y, TileCol: x, Style: product.wmts.style };
  const url = product.wmts.template.replace(/\{([^}]+)\}/g, (_, key) => encodeURIComponent(substitutions[key]));
  return safeGibsUrl(url);
}
