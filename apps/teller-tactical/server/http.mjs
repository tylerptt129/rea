import { DiskCache } from './cache.mjs';
import { validateImage } from './images.mjs';
import { XMLValidator } from 'fast-xml-parser';

export const ALLOWED_HOSTS = new Set(['api.weather.gov', 'mesonet.agron.iastate.edu', 'nowcoast.noaa.gov', 'cdn.star.nesdis.noaa.gov', 'mapservices.weather.noaa.gov', 'opengeo.ncep.noaa.gov', 'basemaps.cartocdn.com', 'gibs.earthdata.nasa.gov']);
export function validateRemoteUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || url.hash || !ALLOWED_HOSTS.has(url.hostname)) throw new Error('Remote destination is not an authorized public weather source');
  return url;
}
const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(); };
  const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason); };
  const timer = setTimeout(done, ms); signal?.addEventListener('abort', abort, { once: true });
});
async function subscribed(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) { void promise.catch(() => {}); signal.throwIfAborted(); }
  let abort;
  const cancelled = new Promise((_, reject) => { abort = () => reject(signal.reason ?? new Error('Request cancelled')); signal.addEventListener('abort', abort, { once: true }); });
  try { return await Promise.race([promise, cancelled]); } finally { signal.removeEventListener('abort', abort); }
}

export class WeatherClient {
  constructor({ directory, cache, fetchImpl, maxConcurrent = 4, timeoutMs = 20_000, attempts = 2 } = {}) {
    this.cache = cache ?? new DiskCache(directory);
    this.fetchImpl = fetchImpl;
    this.maxConcurrent = maxConcurrent;
    this.timeoutMs = timeoutMs;
    this.attempts = attempts;
    this.active = 0;
    this.queue = [];
    this.inflight = new Map();
    this.stats = { networkRequests: 0, downloadedBytes: 0, cacheHits: 0, staleFallbacks: 0, failures: 0 };
    this.lastErrors = [];
  }
  async acquire(signal) {
    signal.throwIfAborted();
    if (this.active >= this.maxConcurrent || this.queue.length) { await new Promise((resolve, reject) => {
      const entry = { resolve: () => { signal.removeEventListener('abort', cancel); resolve(); } };
      const cancel = () => { this.queue = this.queue.filter(e => e !== entry); reject(signal.reason); };
      signal.addEventListener('abort', cancel, { once: true }); this.queue.push(entry);
    }); return; }
    this.active++;
  }
  release() { const next = this.queue.shift(); if (next) next.resolve(); else this.active--; }
  async fetch(url, options) {
    if (this.fetchImpl) return this.fetchImpl(url, options);
    if (!this.dispatcher) {
      const { EnvHttpProxyAgent, fetch } = await import('undici');
      this.dispatcher = new EnvHttpProxyAgent(); this.nativeFetch = fetch;
    }
    return this.nativeFetch(url, { ...options, dispatcher: this.dispatcher });
  }
  async bytes(value, { ttl = 300_000, maxBytes = 12 * 1024 * 1024, signal, category = 'image', image = {}, format, admission } = {}) {
    const url = validateRemoteUrl(value).href;
    signal?.throwIfAborted();
    if (image.profile && image.profile !== 'iem-native-indexed') throw new Error('Unknown source image admission profile');
    if (image.profile === 'iem-native-indexed' && (admission?.key !== 'iem-native-indexed-v1' || typeof admission.validate !== 'function')) throw new Error('Native radar images require their worker-backed source admission');
    if (admission && (typeof admission.key !== 'string' || typeof admission.validate !== 'function')) throw new Error('Source admission requires a named validator');
    const cached = await this.acceptedCache(url, { category, maxBytes, image, format, admission, signal });
    // Cache IO/admission is asynchronous; a consumer may cancel while it runs.
    // Do not create an unobserved source flight after that cancellation.
    signal?.throwIfAborted();
    if (cached) { this.stats.cacheHits++; return cached; }
    // Admission format and byte/geometry budgets affect the result, so only
    // equivalent consumers share an in-flight validation/cache operation.
    const requestKey = JSON.stringify([url, category, format ?? null, maxBytes, image.width ?? null, image.height ?? null, image.maxDimension ?? null, image.maxPixels ?? null, image.profile ?? null, admission?.key ?? null, admission?.owner ?? null]);
    let flight = this.inflight.get(requestKey);
    if (!flight) {
      const controller = new AbortController();
      flight = { controller, subscribers: 0 };
      flight.promise = this.request(url, { ttl, maxBytes, category, image, format, admission, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs)]) }).finally(() => this.inflight.delete(requestKey));
      this.inflight.set(requestKey, flight);
    }
    flight.subscribers++;
    try { return await subscribed(flight.promise, signal); }
    finally { if (--flight.subscribers === 0 && this.inflight.has(requestKey)) flight.controller.abort(new Error('No remaining request subscribers')); }
  }
  async admit(data, contentType, { category, maxBytes, image = {}, format, admission, signal, url }) {
    signal?.throwIfAborted();
    if (category === 'image' && image.profile !== 'iem-native-indexed') validateImage(data, contentType, { ...image, maxBytes });
    if (format === 'xml' && XMLValidator.validate(data.toString('utf8')) !== true) throw Object.assign(new Error(`Malformed XML from ${new URL(url).hostname}`), { retryable: false });
    let parsedJson;
    if (format === 'json') {
      try { parsedJson = JSON.parse(data.toString('utf8')); }
      catch { throw Object.assign(new Error(`Malformed JSON from ${new URL(url).hostname}`), { retryable: false }); }
    }
    const admissionFact = admission ? await admission.validate(data, contentType, { signal, sourceUrl: url }) : undefined;
    return { ...(format === 'json' ? { parsedJson } : {}), ...(admission ? { admissionFact } : {}) };
  }
  async acceptedCache(url, { category, maxBytes, image = {}, format, admission, signal, allowStale = false }) {
    const cached = await this.cache.get(url, { allowStale });
    if (!cached) return null;
    if (cached.data.length > maxBytes) throw new Error('Weather source cached response exceeds the byte limit');
    try { return { ...cached, ...await this.admit(cached.data, cached.contentType, { category, maxBytes, image, format, admission, signal, url }) }; }
    catch (error) {
      if (signal?.aborted || error.retryable !== false) throw error;
      await this.cache.remove(url);
      return null;
    }
  }

  async request(url, { ttl, maxBytes, category, signal, image, format, admission }) {
    let acquired = false;
    try {
      await this.acquire(signal); acquired = true;
      for (let attempt = 0; attempt < this.attempts; attempt++) {
        try {
          signal.throwIfAborted();
          this.stats.networkRequests++;
          const response = await this.fetch(url, { signal, redirect: 'error', headers: { 'User-Agent': 'TellerTactical/0.1 (local weather workstation)', Accept: category === 'metadata' ? 'application/geo+json, application/json, application/xml, text/xml, text/plain' : 'image/png, image/jpeg, image/webp, */*' } });
          if (!response.ok) {
            await response.body?.cancel();
            const error = new Error(`Weather source returned HTTP ${response.status}: ${new URL(url).hostname}`);
            error.retryable = response.status === 429 || response.status >= 500;
            throw error;
          }
          const length = Number(response.headers.get('content-length'));
          if (length > maxBytes) { await response.body?.cancel(); throw new Error('Weather source response exceeds the byte limit'); }
          const chunks = []; let count = 0;
          if (!response.body) throw new Error('Weather source returned an empty response');
          for await (const chunk of response.body) {
            count += chunk.byteLength;
            if (count > maxBytes) throw new Error('Weather source response exceeds the byte limit');
            chunks.push(Buffer.from(chunk));
          }
          const data = Buffer.concat(chunks);
          this.stats.downloadedBytes += count;
          const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
          const facts = await this.admit(data, contentType, { category, maxBytes, image, format, admission, signal, url });
          // Source validity is established before replacing the last accepted bytes.
          await this.cache.put(url, data, { ttl, contentType, category });
          return { data, contentType, retrievedAt: new Date().toISOString(), stale: false, sourceUrl: url, ...facts };
        } catch (error) {
          if (signal.aborted || error.retryable === false || /HTTP 4\d\d|byte limit|empty response/.test(error.message) && !error.retryable || attempt + 1 >= this.attempts) throw error;
          await wait(250 * (2 ** attempt), signal);
        }
      }
    } catch (error) {
      this.stats.failures++;
      this.lastErrors.push({ at: new Date().toISOString(), source: new URL(url).hostname, message: error.message }); this.lastErrors = this.lastErrors.slice(-20);
      if (signal.aborted && /No remaining/.test(String(signal.reason))) throw error;
      const old = await this.acceptedCache(url, { category, maxBytes, image, format, admission, signal: signal.aborted ? undefined : signal, allowStale: true });
      if (old) { this.stats.staleFallbacks++; return { ...old, stale: true, error: error.message }; }
      throw error;
    } finally { if (acquired) this.release(); }
  }
  async json(url, options = {}) {
    const { parsedJson, ...result } = await this.bytes(url, { ...options, category: 'metadata', format: 'json', maxBytes: options.maxBytes ?? 8 * 1024 * 1024 });
    return { ...result, data: parsedJson };
  }

  diagnostics() { return { ...this.stats, cache: this.cache.diagnostics(), activeRequests: this.active, queuedRequests: this.queue.length, errors: this.lastErrors }; }
  async close() { for (const flight of this.inflight.values()) flight.controller.abort(new Error('Client shutting down')); await Promise.allSettled([...this.inflight.values()].map(f => f.promise)); await this.dispatcher?.close(); }
}
