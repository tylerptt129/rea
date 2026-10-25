import test from 'node:test';
import assert from 'node:assert/strict';
import { requireNativeProbeSample } from '../scripts/packaged-live-smoke.mjs';

const now = Date.parse('2026-01-15T18:35:00Z');
const context = { frame: { id: '202601151830', time: '2026-01-15T18:30:00Z', verified: true }, latitude: 38.8339, longitude: -104.8214, startedAt: now - 1000, now };
function sample(index = 160) {
  return {
    fixture: false, available: index !== 0, nativeIndex: index, value: index === 0 ? null : index * 0.5 - 32.5, units: 'dBZ', quantizationDbz: 0.5, stale: false,
    sourceUrl: 'https://mesonet.agron.iastate.edu/archive/data/2026/01/15/GIS/uscomp/n0q_202601151830.png',
    worldfileUrl: 'https://mesonet.agron.iastate.edu/archive/data/2026/01/15/GIS/uscomp/n0q_202601151830.wld', observationTime: context.frame.time,
    retrievedAt: new Date(now).toISOString(), worldfileRetrievedAt: new Date(now).toISOString(), latitude: context.latitude, longitude: context.longitude,
    cell: { column: 4236, row: 1512, width: 9000, height: 4500, bounds: { west: -104.825, east: -104.82, south: 38.83, north: 38.835 }, resolution: { projection: 'EPSG:4326', units: 'degrees' }, sampling: 'nearest native pixel center; no spatial interpolation' },
    limitations: ['Quantized IEM provider composite, not raw single-site radar.'], quality: 'provider-composite quantized native index',
    ...(index === 0 ? { reason: 'Native index0 cannot distinguish missing coverage and no echo.' } : {}),
  };
}

test('packaged native probe acceptance proves real source identity, grid and fixed quantized classes including valid zero', () => {
  for (const [index, value] of [[1, -32], [65, 0], [160, 47.5], [255, 95]]) {
    const result = requireNativeProbeSample(sample(index), context);
    assert.equal(result.value, value);
    assert.equal(result.liveQuantitativeValueVerified, true);
    assert.equal(result.workerBackedNativeIndexVerified, true);
    assert.equal(result.retrievedAt, sample(index).retrievedAt);
  }
});

test('source index0 is an honest successful missing-data sample, never invented clear weather or0dBZ', () => {
  const result = requireNativeProbeSample(sample(0), context);
  assert.equal(result.available, false); assert.equal(result.value, null);
  assert.equal(result.liveQuantitativeValueVerified, false);
  assert.throws(() => requireNativeProbeSample({ ...sample(0), value: 0 }, context), /cannot become0dBZ/);
  assert.throws(() => requireNativeProbeSample({ ...sample(0), reason: 'Clear weather' }, context), /ambiguity/);
});

test('ASAR worker/decode failure or wrong-frame geometry cannot pass as ordinary missing observations', () => {
  assert.throws(() => requireNativeProbeSample({ ...sample(), available: false, nativeIndex: null, value: null, cell: null, reason: 'Cannot find worker in app.asar' }, context), /No admitted native raster/);
  assert.throws(() => requireNativeProbeSample({ ...sample(), nativeIndex: null }, context), /No accepted native index/);
  assert.throws(() => requireNativeProbeSample({ ...sample(), sourceUrl: 'https://example.com/rendered-rgb.png' }, context), /source PNG/);
  assert.throws(() => requireNativeProbeSample({ ...sample(), observationTime: '2026-01-15T18:25:00Z' }, context), /observation timestamp/);
  assert.throws(() => requireNativeProbeSample({ ...sample(), cell: { ...sample().cell, column: 9000 } }, context), /outside/);
  assert.throws(() => requireNativeProbeSample({ ...sample(), value: 47.6 }, context), /mapping/);
  assert.throws(() => requireNativeProbeSample({ ...sample(), stale: true }, context), /fresh accepted/);
  assert.throws(() => requireNativeProbeSample({ ...sample(), retrievedAt: '2025-01-01T00:00:00Z' }, context), /current-run/);
  assert.throws(() => requireNativeProbeSample({ ...sample(), fixture: true }, context), /fixture/);
});
