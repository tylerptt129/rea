import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../server/index.mjs';
import { fixturePng } from '../server/catalog.mjs';
import { requireLiveCatalog, requireLivePoint, coordinateTile, inspectPng } from '../scripts/live-smoke.mjs';

const frame = (minutes) => ({ id: `time-${minutes}`, time: new Date(Date.now() - minutes * 60_000).toISOString(), verified: true });
const catalog = () => ({ fixture: false, stale: false, products: [{ id: 'iem-n0q', kind: 'radar', sourceUrl: 'https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/', frames: [frame(10), frame(5)], stale: false }] });

test('live catalog validation rejects fixtures, unknown provenance, stale caches, and zero/unverified frames', () => {
  assert.equal(requireLiveCatalog(catalog()).frames.length, 2);
  for (const bad of [{ ...catalog(), fixture: true }, { ...catalog(), fixture: undefined }, { ...catalog(), stale: true }, { fixture: false, products: [] }]) assert.throws(() => requireLiveCatalog(bad));
  const duplicate = frame(5);
  for (const change of [{ fixture: true }, { sourceUrl: 'fixture://weather' }, { frames: [frame(5)] }, { frames: [frame(5), { ...frame(10), verified: false }] }, { frames: [duplicate, { ...duplicate }] }]) {
    const value = catalog(); Object.assign(value.products[0], change);
    assert.throws(() => requireLiveCatalog(value));
  }
});

test('explicit fixture:false cannot inherit TELLER_FIXTURE=1 or turn an offline live catalog into fixture success', async (t) => {
  const old = process.env.TELLER_FIXTURE;
  process.env.TELLER_FIXTURE = '1';
  t.after(() => { if (old === undefined) delete process.env.TELLER_FIXTURE; else process.env.TELLER_FIXTURE = old; });
  const directory = await mkdtemp(join(tmpdir(), 'teller-live-mode-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const client = { json: async () => { calls++; throw new Error('Deterministic source unavailable; no remote requests made.'); }, close: async () => {} };
  const instance = await startServer({ port: 0, dataDir: directory, fixture: false, client });
  t.after(() => instance.close());
  const health = await (await fetch(instance.url + '/api/health')).json();
  const products = await (await fetch(instance.url + '/api/catalog')).json();
  assert.equal(health.fixture, false);
  assert.equal(products.fixture, false);
  assert.deepEqual(products.products, []);
  assert.ok(calls > 0, 'The live path attempted the injected source boundary.');
  assert.throws(() => requireLiveCatalog(products), { code: 'RADAR_CATALOG_UNAVAILABLE' });
});

test('Colorado tile is derived from coordinates and PNG validation rejects truncated/non-PNG payloads', () => {
  assert.deepEqual(coordinateTile(-104.8214, 38.8339, 6), { z: 6, x: 13, y: 24 });
  const png = fixturePng(6, 13, 24);
  assert.equal(inspectPng(png).width, 256);
  assert.throws(() => inspectPng(Buffer.from('<ServiceException>no image</ServiceException>')));
  assert.throws(() => inspectPng(png.subarray(0, png.length - 5)), { code: 'TRUNCATED_RADAR_PNG' });
});

test('zero alerts can pass only with an actual official response, and missing forecasts/observations cannot pass', () => {
  const now = new Date().toISOString();
  const point = { fixture: false, stale: false, periods: [{ startTime: now, endTime: new Date(Date.now() + 3600_000).toISOString() }], observations: [{ timestamp: now, sourceUrl: 'https://api.weather.gov/stations/KCOS/observations/latest' }], alerts: [], alertStatus: { expired: 0, unknownExpiry: 0 }, sources: [{ name: 'alerts', sourceUrl: 'https://api.weather.gov/alerts/active?point=38.8339,-104.8214', retrievedAt: now, stale: false }] };
  assert.equal(requireLivePoint(point).alerts.length, 0);
  for (const change of [{ fixture: true }, { periods: [] }, { observations: [] }, { sources: [] }, { stale: true }]) assert.throws(() => requireLivePoint({ ...point, ...change }));
});
