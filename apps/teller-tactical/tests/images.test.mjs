import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import jpeg from 'jpeg-js';
import { validateImage } from '../server/images.mjs';
import { WeatherClient } from '../server/http.mjs';
import { DiskCache } from '../server/cache.mjs';
import { fixturePng } from '../server/catalog.mjs';

const png = fixturePng(8, 53, 98);
const url = 'https://mesonet.agron.iastate.edu/test-image.png';
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
async function temporary(t) { const dir = await mkdtemp(join(tmpdir(), 'teller-images-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const bytes = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(body.length); checksum.writeUInt32BE(crc32(Buffer.concat([bytes, body])));
  return Buffer.concat([length, bytes, body, checksum]);
}
function chunks(image) {
  const records = [];
  for (let offset = 8; offset < image.length;) {
    const length = image.readUInt32BE(offset);
    records.push({ type: image.toString('ascii', offset + 4, offset + 8), body: Buffer.from(image.subarray(offset + 8, offset + 8 + length)) });
    offset += length + 12;
  }
  return records;
}
const assemble = records => Buffer.concat([signature, ...records.map(record => chunk(record.type, record.body))]);
const change = (image, type, transform) => assemble(chunks(image).map(record => record.type === type ? { ...record, body: transform(record.body) } : record));
function tinyPng({ indexed = false, interlace = false } = {}) {
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = indexed ? 3 : 6; header[12] = +interlace;
  return assemble([{ type: 'IHDR', body: header }, ...(indexed ? [{ type: 'PLTE', body: Buffer.from([10, 20, 30]) }] : []), { type: 'IDAT', body: deflateSync(Buffer.from(indexed ? [0, 0] : [0, 10, 20, 30, 255])) }, { type: 'IEND', body: Buffer.alloc(0) }]);
}
const imageResponse = bytes => new Response(bytes, { headers: { 'content-type': 'image/png' } });

test('PNG admission checks real rendered RGBA pixels, indexed palettes and Adam7 rows', () => {
  assert.deepEqual(validateImage(png, 'image/png', { width: 256, height: 256 }), { format: 'png', width: 256, height: 256 });
  assert.equal(validateImage(tinyPng({ indexed: true }), 'image/png').width, 1);
  assert.equal(validateImage(tinyPng({ interlace: true }), 'image/png').height, 1);
  assert.throws(() => validateImage(tinyPng(), 'image/png', { width: 256, height: 256 }), /requested product/);
});

test('PNG checksum, compression, row geometry, filters and resource bounds are independently enforced', () => {
  for (const invalid of [signature, png.subarray(0, png.length - 1), Buffer.concat([png, Buffer.from('trailing')])]) assert.throws(() => validateImage(invalid, 'image/png'));
  const checksum = Buffer.from(png); checksum[checksum.length - 1] ^= 1;
  assert.throws(() => validateImage(checksum, 'image/png'), /checksum/);
  const badCompression = change(png, 'IDAT', body => { body[0] = 0; return body; });
  assert.throws(() => validateImage(badCompression, 'image/png'), /compression/);
  const badGeometry = change(png, 'IDAT', body => deflateSync(inflateSync(body).subarray(0, -1)));
  assert.throws(() => validateImage(badGeometry, 'image/png'), /geometry/);
  const badFilter = change(png, 'IDAT', body => { const pixels = inflateSync(body); pixels[0] = 5; return deflateSync(pixels); });
  assert.throws(() => validateImage(badFilter, 'image/png'), /filter/);
  const oversized = change(png, 'IHDR', body => { body.writeUInt32BE(1_000_000); return body; });
  assert.throws(() => validateImage(oversized, 'image/png'), /resource limits/);
});

test('JPEG admission fully decodes bounded image data and rejects truncation, mismatched MIME and dimensions', () => {
  const data = Buffer.alloc(16 * 16 * 4, 170);
  const encoded = jpeg.encode({ width: 16, height: 16, data }, 85).data;
  assert.deepEqual(validateImage(encoded, 'image/jpeg'), { format: 'jpeg', width: 16, height: 16 });
  assert.throws(() => validateImage(encoded.subarray(0, -2), 'image/jpeg'), /truncated/);
  assert.throws(() => validateImage(encoded, 'image/png'), /PNG signature/);
  assert.throws(() => validateImage(png, 'image/jpeg'), /JPEG/);
  assert.throws(() => validateImage(encoded, 'image/jpeg', { width: 256, height: 256 }), /requested product/);
  const scan = encoded.indexOf(Buffer.from([0xff, 0xda]));
  const scanLength = encoded.readUInt16BE(scan + 2);
  const absentEntropy = Buffer.concat([encoded.subarray(0, scan + 2 + scanLength), Buffer.from([0xff, 0xd9])]);
  assert.throws(() => validateImage(absentEntropy, 'image/jpeg'), /JPEG image data/);
  assert.throws(() => validateImage(png, 'image/svg+xml'), /PNG\/JPEG required/);
});

test('HTTP200 mislabeled/corrupt image never enters cache and a later valid response recovers', async t => {
  let calls = 0;
  const client = new WeatherClient({ directory: await temporary(t), attempts: 2, fetchImpl: async () => imageResponse(++calls === 1 ? signature : png) });
  t.after(() => client.close());
  await assert.rejects(client.bytes(url), /Invalid weather image/);
  assert.equal(calls, 1, 'an invalid source image is not immediately retried unchanged');
  assert.equal(await client.cache.get(url, { allowStale: true }), null);
  assert.equal((await client.bytes(url)).data.equals(png), true);
  assert.equal(calls, 2);
});

test('legacy poisoned fresh cache entries are evicted and refetched instead of reused for seven days', async t => {
  const cache = new DiskCache(await temporary(t));
  await cache.put(url, signature, { ttl: 7 * 86400_000, contentType: 'image/png' });
  let calls = 0;
  const client = new WeatherClient({ cache, fetchImpl: async () => { calls++; return imageResponse(png); } });
  t.after(() => client.close());
  const result = await client.bytes(url);
  assert.equal(calls, 1); assert.equal(result.data.equals(png), true);
  assert.equal(client.stats.cacheHits, 0);
  assert.equal((await cache.get(url)).data.equals(png), true);
});

test('invalid stale images cannot masquerade as last-known data during an outage', async t => {
  let now = 1000;
  const cache = new DiskCache(await temporary(t), { now: () => now });
  await cache.put(url, signature, { ttl: 10, contentType: 'image/png' });
  now = 2000;
  const client = new WeatherClient({ cache, attempts: 1, fetchImpl: async () => { throw new Error('Offline'); } });
  t.after(() => client.close());
  await assert.rejects(client.bytes(url), /Offline/);
  assert.equal(await cache.get(url, { allowStale: true }), null);
  assert.equal(client.stats.staleFallbacks, 0);
});

test('failed new-image admission preserves a valid stale image with its original retrieval time', async t => {
  let now = 1000;
  const cache = new DiskCache(await temporary(t), { now: () => now });
  await cache.put(url, png, { ttl: 10, contentType: 'image/png' }); now = 2000;
  const client = new WeatherClient({ cache, attempts: 1, fetchImpl: async () => imageResponse(signature) });
  t.after(() => client.close());
  const result = await client.bytes(url);
  assert.equal(result.stale, true); assert.equal(result.data.equals(png), true);
  assert.equal(result.retrievedAt, new Date(1000).toISOString());
});

test('malformed HTTP200 JSON cannot overwrite accepted stale forecast metadata', async t => {
  let now = 1000;
  const cache = new DiskCache(await temporary(t), { now: () => now });
  const jsonUrl = 'https://api.weather.gov/test-forecast';
  await cache.put(jsonUrl, Buffer.from('{"periods":[{"name":"Last accepted"}]}'), { ttl: 10, contentType: 'application/json', category: 'metadata' }); now = 2000;
  const client = new WeatherClient({ cache, attempts: 1, fetchImpl: async () => new Response('{"periods":truncated', { headers: { 'content-type': 'application/json' } }) });
  t.after(() => client.close());
  const result = await client.json(jsonUrl);
  assert.equal(result.stale, true);
  assert.equal(result.data.periods[0].name, 'Last accepted');
  assert.equal(result.retrievedAt, new Date(1000).toISOString());
  assert.equal(JSON.parse((await cache.get(jsonUrl, { allowStale: true })).data).periods[0].name, 'Last accepted');
});

test('legacy poisoned JSON cache entries are refetched and parsed once at source admission', async t => {
  const cache = new DiskCache(await temporary(t));
  const jsonUrl = 'https://api.weather.gov/test-json';
  await cache.put(jsonUrl, Buffer.from('invalid-json'), { contentType: 'application/json', category: 'metadata' });
  let calls = 0;
  const client = new WeatherClient({ cache, fetchImpl: async () => { calls++; return new Response('{"accepted":true}', { headers: { 'content-type': 'application/json' } }); } });
  t.after(() => client.close());
  const result = await client.json(jsonUrl);
  assert.equal(calls, 1); assert.deepEqual(result.data, { accepted: true });
  assert.equal(Object.hasOwn(result, 'parsedJson'), false, 'private parsed transport representation is not duplicated in public result');
});

test('concurrent raw and parsed consumers retain their own admission contract', async t => {
  let calls = 0;
  const client = new WeatherClient({ directory: await temporary(t), fetchImpl: async () => { calls++; return new Response('{"accepted":true}', { headers: { 'content-type': 'application/json' } }); } });
  t.after(() => client.close());
  const source = 'https://api.weather.gov/shared-json';
  const [raw, parsed] = await Promise.all([client.bytes(source, { category: 'metadata' }), client.json(source)]);
  assert.equal(Buffer.isBuffer(raw.data), true);
  assert.deepEqual(parsed.data, { accepted: true });
  assert.equal(calls, 2, 'in-flight operations with different validation policies must not inherit one another’s parsed result');
});

test('malformed HTTP200 XML cannot replace the last accepted satellite metadata', async t => {
  let now = 1000;
  const cache = new DiskCache(await temporary(t), { now: () => now });
  const source = 'https://gibs.earthdata.nasa.gov/test-domain.xml';
  const xml = '<Domains><DimensionDomain><Domain>2026-10-25T11:00:00Z</Domain></DimensionDomain></Domains>';
  await cache.put(source, Buffer.from(xml), { ttl: 10, contentType: 'application/xml', category: 'metadata' }); now = 2000;
  const client = new WeatherClient({ cache, attempts: 1, fetchImpl: async () => new Response('<Domains><DimensionDomain>', { headers: { 'content-type': 'application/xml' } }) });
  t.after(() => client.close());
  const result = await client.bytes(source, { category: 'metadata', format: 'xml' });
  assert.equal(result.stale, true); assert.equal(result.data.toString(), xml);
  assert.equal(result.retrievedAt, new Date(1000).toISOString());
  assert.equal((await cache.get(source, { allowStale: true })).data.toString(), xml);
});

test('cancellation during asynchronous cache lookup cannot start an unobserved source request', async t => {
  const cache = new DiskCache(await temporary(t));
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const get = cache.get.bind(cache);
  cache.get = async (...args) => { entered.resolve(); await release.promise; return get(...args); };
  let calls = 0;
  const client = new WeatherClient({ cache, fetchImpl: async () => { calls++; return imageResponse(png); } });
  t.after(() => client.close());
  const controller = new AbortController();
  const pending = client.bytes(url, { signal: controller.signal });
  const cancelled = assert.rejects(pending, /cancelled during cache IO/);
  await entered.promise; controller.abort(new Error('cancelled during cache IO')); release.resolve();
  await cancelled;
  assert.equal(calls, 0); assert.equal(client.inflight.size, 0);
});
