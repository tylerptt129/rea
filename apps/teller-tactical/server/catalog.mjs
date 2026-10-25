import { deflateSync } from 'node:zlib';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { tileBBox } from '../src/domain.mjs';
import { parseColorMapLegend, renderColorMapLegend } from './legends.mjs';
import { discoverSatellite, satelliteTileUrl, safeGibsUrl } from './satellite.mjs';

const IEM = 'https://mesonet.agron.iastate.edu';
const WMS = `${IEM}/cgi-bin/wms/nexrad/n0q-t.cgi`;
const frameId = value => value.replace(/[-:TZ.]/g, '').slice(0, 12);
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/;

export function validFrames(scans, now = Date.now()) {
  if (!Array.isArray(scans)) throw new Error('Radar archive returned no scan list');
  const unique = new Map();
  for (const scan of scans) {
    if (typeof scan.ts !== 'string' || !ISO_TIME.test(scan.ts)) continue;
    const time = Date.parse(scan.ts);
    if (!Number.isFinite(time) || time > now + 60_000 || time < now - 6 * 3600_000) continue;
    unique.set(time, { id: frameId(scan.ts), time: new Date(time).toISOString(), verified: true });
  }
  return [...unique.entries()].sort((a, b) => a[0] - b[0]).slice(-18).map(([, frame]) => frame);
}

export class ProductCatalog {
  constructor(client, { fixture = false, now = Date.now, statePath } = {}) { this.client = client; this.fixture = fixture; this.now = now; this.products = new Map(); this.current = null; this.pending = null; this.statePath = statePath; this.restored = false; this.lastProducts = []; }
  async get({ force = false } = {}) {
    if (!this.restored && !this.fixture && this.statePath) {
      this.restored = true;
      try {
        const saved = JSON.parse(await readFile(this.statePath, 'utf8'));
        const safe = saved.products.filter(p => {
          const validTimes = Array.isArray(p.frames) && p.frames.length <= 18 && p.frames.every(f => typeof f.time === 'string' && ISO_TIME.test(f.time) && typeof f.id === 'string');
          if (!validTimes) return false;
          if (p.id === 'iem-n0q') return p.serviceUrl === WMS && p.wmsLayer === 'nexrad-n0q-wmst' && p.frames.every(f => f.id === frameId(f.time));
          if (!p.id?.startsWith('gibs-') || !p.wmts || !p.wmts.matrices || !Object.keys(p.wmts.matrices).length) return false;
          try { safeGibsUrl(p.wmts.template, { template: true }); if (p.legendRemote) safeGibsUrl(p.legendRemote); if(p.colorMapRemote)safeGibsUrl(p.colorMapRemote); return true; } catch { return false; }
        });
        if (safe.length) {
          this.lastProducts = safe.map(p => ({ ...p, stale: true }));
          this.current = { loadedAt: 0, value: { products: this.lastProducts.map(publicProduct), errors: [], retrievedAt: saved.retrievedAt, fixture: false, stale: true } };
        }
      } catch { /* Missing/corrupt snapshot is not weather data. */ }
    }
    if (!force && this.current && this.now() - this.current.loadedAt < 60_000) return this.current.value;
    if (this.pending) return this.pending;
    this.pending = this.load().finally(() => { this.pending = null; });
    return this.pending;
  }
  async load() {
    const products = [], errors = [];
    let stale = false;
    if (this.fixture) {
      const latest = Date.UTC(2026, 0, 15, 18, 30);
      const frames = Array.from({ length: 8 }, (_, i) => { const time = new Date(latest - (7 - i) * 300_000).toISOString(); return { id: frameId(time), time, verified: false }; });
      for (const [id, name, kind, units] of [['fixture-radar', 'Synthetic reflectivity • TEST DATA', 'radar', 'dBZ'], ['fixture-ir', 'Synthetic infrared • TEST DATA', 'satellite', null], ['fixture-visible', 'Synthetic visible • TEST DATA', 'satellite', null], ['fixture-water-vapor', 'Synthetic water vapor • TEST DATA', 'satellite', null]]) {
        products.push({ id, name, kind, source: 'Deterministic synthetic fixture', sourceUrl: '', units, projection: 'EPSG:3857', cadenceMinutes: 5, frames, coverage: 'Synthetic Colorado test field, not weather observations', notes: ['TEST DATA ONLY — not current, observed, or operational.', 'Numerical probing intentionally unavailable.'], numericalProbe: false, stale: false, fixture: true });
      }
    } else {
      // Independent metadata sources run concurrently; a slow satellite service
      // cannot consume a second sequential request timeout after radar discovery.
      const satelliteTask = discoverSatellite(this.client, { now: this.now() }).then(value => ({ value }), error => ({ error }));
      try {
        const end = new Date(this.now()).toISOString();
        const start = new Date(this.now() - 90 * 60_000).toISOString();
        const url = new URL(`${IEM}/json/radar`);
        url.search = new URLSearchParams({ operation: 'list', radar: 'USCOMP', product: 'N0Q', start, end }).toString();
        // A stable 5-minute query bucket permits cross-launch metadata caching without claiming it is an observation.
        url.searchParams.set('start', new Date(Math.floor((this.now() - 90 * 60_000) / 300_000) * 300_000).toISOString());
        url.searchParams.set('end', new Date(Math.floor(this.now() / 300_000) * 300_000).toISOString());
        const response = await this.client.json(url.href, { ttl: 45_000 });
        const frames = validFrames(response.data.scans, this.now());
        if (!frames.length) throw new Error('IEM returned no verified recent mosaic frame times');
        stale ||= response.stale;
        products.push({ id: 'iem-n0q', name: 'CONUS reflectivity mosaic', kind: 'radar', source: 'Iowa Environmental Mesonet / NWS Level III', sourceUrl: `${IEM}/docs/nexrad_mosaic/`, units: 'dBZ', projection: 'EPSG:3857', cadenceMinutes: 5, frames, coverage: 'CONUS provider composite; not raw single-site radar', notes: ['Nominal mosaic times are archive-published times. Individual radar inputs can be up to 15 minutes old.', 'Beam blockage, beam overshoot, attenuation, anomalous propagation, and missing source radars limit coverage.', 'Numeric probes use original indexed archive pixels and worldfile registration, quantized to 0.5 dBZ; not resampled display colors.'], numericalProbe: true, quantizationDbz: 0.5, legendUrl: '/api/legend/iem-n0q', serviceUrl: WMS, wmsLayer: 'nexrad-n0q-wmst', stale: response.stale, retrievedAt: response.retrievedAt });
      } catch (error) { errors.push({ source: 'IEM radar', message: error.message }); }
      try {
        const outcome = await satelliteTask;
        if (outcome.error) throw outcome.error;
        const satellite = outcome.value;
        products.push(...satellite.products);
        errors.push(...satellite.errors);
        stale ||= satellite.stale;
      } catch (error) { errors.push({ source: 'NASA GIBS satellite', message: error.message }); }
      // Each source retains its own last-known products during an outage. The
      // private source descriptor stays with the product owner, not its UI view.
      for (const previous of this.lastProducts) {
        if (!products.some(p => p.id === previous.id)) { products.push({ ...previous, stale: true }); stale = true; }
      }
    }
    this.products.clear(); for (const product of products) this.products.set(product.id, product);
    const value = { products: products.map(publicProduct), errors, retrievedAt: new Date(this.now()).toISOString(), fixture: this.fixture, stale };
    this.lastProducts = products;
    this.current = { loadedAt: this.now(), value };
    if (!this.fixture && this.statePath && products.length) {
      const temporary = `${this.statePath}.tmp`;
      await writeFile(temporary, JSON.stringify({ products, retrievedAt: value.retrievedAt }), { mode: 0o600 });
      await rename(temporary, this.statePath);
    }
    return value;
  }
  async tile(productId, frameIdValue, z, x, y, { signal } = {}) {
    if (!this.products.has(productId)) await this.get();
    const product = this.products.get(productId);
    if (!product) throw Object.assign(new Error('Unknown or unavailable product'), { status: 404 });
    const frame = product.frames.find(f => f.id === frameIdValue);
    if (!frame) throw Object.assign(new Error('Unknown frame; refresh available frames'), { status: 404 });
    const bbox = tileBBox(z, x, y);
    if (this.fixture) return { data: fixturePng(z, x, y, product.frames.indexOf(frame), product.kind === 'satellite'), contentType: 'image/png', retrievedAt: new Date(this.now()).toISOString(), stale: false, sourceUrl: 'synthetic-fixture', observationTime: frame.time };
    if (product.wmts) {
      const url = satelliteTileUrl(product, frame, z, x, y);
      return { ...await this.client.bytes(url, { ttl: 7 * 86400_000, maxBytes: 2 * 1024 * 1024, signal, image: { width: 256, height: 256 } }), observationTime: frame.time };
    }
    const url = new URL(product.serviceUrl);
    url.search = new URLSearchParams({ SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap', LAYERS: product.wmsLayer, STYLES: '', SRS: 'EPSG:3857', BBOX: bbox.join(','), WIDTH: '256', HEIGHT: '256', FORMAT: 'image/png', TRANSPARENT: 'TRUE', TIME: frame.time }).toString();
    return { ...await this.client.bytes(url.href, { ttl: 7 * 86400_000, maxBytes: 2 * 1024 * 1024, signal, image: { width: 256, height: 256 } }), observationTime: frame.time };
  }
  async legend(productId, { signal } = {}) {
    if (!this.products.has(productId)) await this.get();
    const product = this.products.get(productId);
    if (!product || !product.legendUrl) throw Object.assign(new Error('Source legend is unavailable for this product'), { status: 404 });
    let url;
    if (product.legendRemote) url = safeGibsUrl(product.legendRemote);
    else if(product.colorMapRemote){
      const response=await this.client.bytes(safeGibsUrl(product.colorMapRemote),{ttl:86400_000,maxBytes:1024*1024,category:'metadata',format:'xml',admission:{key:'gibs-colormap-v1',validate:bytes=>{try{return parseColorMapLegend(bytes);}catch(error){error.retryable=false;throw error;}}},signal});
      const legend=renderColorMapLegend(response.data,{title:product.name});
      return {...response,data:legend.data,contentType:legend.contentType};
    }
    else if (product.id === 'iem-n0q') {
      const request = new URL(WMS);
      request.search = new URLSearchParams({ SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetLegendGraphic', LAYER: product.wmsLayer, FORMAT: 'image/png' }).toString();
      url = request.href;
    } else throw Object.assign(new Error('Source legend is unavailable'), { status: 404 });
    return this.client.bytes(url, { ttl: 86400_000, maxBytes: 1024 * 1024, signal });
  }
}

function publicProduct({ serviceUrl, wmsLayer, wmts, legendRemote, colorMapRemote, ...product }) { return product; }

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0; });
const crc32 = buffer => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ c >>> 8; return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([length, t, data, checksum]); };
export function fixturePng(z, x, y, frame = 0, satellite = false, basemap = false, light = false) {
  const pixels = Buffer.alloc(256 * (256 * 4 + 1));
  for (let py = 0; py < 256; py++) {
    for (let px = 0; px < 256; px++) {
      const lon = ((x + px / 256) / 2 ** z) * 360 - 180;
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * ((y + py / 256) / 2 ** z)))) * 180 / Math.PI;
      const offset = py * 1025 + 1 + px * 4;
      if (basemap) {
        const grid = Math.abs(lon - Math.round(lon)) < 0.006 * 2 ** (8 - z) || Math.abs(lat - Math.round(lat)) < 0.005 * 2 ** (8 - z);
        const v = light ? (grid ? 188 : 222) : (grid ? 49 : 26);
        pixels.set([v, v + (light ? 2 : 5), v + (light ? 1 : 9), 255], offset);
        continue;
      }
      const d = Math.sqrt(((lon + 105.3 - frame * 0.04) / 1.05) ** 2 + ((lat - 38.95 - frame * 0.018) / 0.40) ** 2);
      const n = Math.sin(lon * 20 + lat * 5) * Math.cos(lat * 17) * 0.14;
      if (d + n < 1.5) {
        const power = Math.max(0, 1 - (d + n) / 1.5);
        const colors = satellite ? [[130, 150, 170], [210, 220, 230], [245, 245, 245]] : [[20, 125, 189], [12, 176, 87], [231, 198, 43], [237, 105, 26], [224, 42, 79]];
        const color = colors[Math.min(colors.length - 1, Math.floor(power * colors.length))];
        pixels.set([...color, Math.round((satellite ? 0.8 : 0.72) * 255)], offset);
      }
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(256); header.writeUInt32BE(256, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
