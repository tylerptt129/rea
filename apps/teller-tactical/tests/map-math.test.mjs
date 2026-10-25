import {test} from 'node:test';
import assert from 'node:assert/strict';
import {coverageRing, viewMatches} from '../src/map-view.js';

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const p = (b[1] - a[1]) * rad, l = (b[0] - a[0]) * rad;
  const h = Math.sin(p / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(l / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(h));
}

test('range guide has constant great-circle distance and exact closure', () => {
  const center = [-104.181, 38.46];
  const ring = coverageRing(...center, 230, 96);
  assert.equal(ring.geometry.type, 'LineString');
  assert.equal(ring.geometry.coordinates.length, 97);
  assert.deepEqual(ring.geometry.coordinates[0], ring.geometry.coordinates.at(-1));
  for (const point of ring.geometry.coordinates) assert.ok(Math.abs(distanceKm(center, point) - 230) < 0.00001);
  assert.match(ring.properties.description, /not modeled/);
});

test('range guide normalizes longitudes around antimeridian', () => {
  const ring = coverageRing(179.5, 25, 230);
  assert.ok(ring.geometry.coordinates.some(([lon]) => lon < 0));
  assert.ok(ring.geometry.coordinates.every(([lon, lat]) => lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90));
});

test('range guide rejects invalid coordinates and resource limits', () => {
  for (const args of [[0, 91], [181, 0], [0,0,NaN], [0,0,-1], [0,0,230,1000000]]) assert.throws(() => coverageRing(...args), RangeError);
});

test('linked views compare camera components with explicit tolerance', () => {
  assert.ok(viewMatches({center:[-105,39],zoom:7}, {center:[-105,39],zoom:7,bearing:0,pitch:0}));
  assert.ok(!viewMatches({center:[-105,39],zoom:7}, {center:[-105,39],zoom:8}));
  assert.ok(!viewMatches({center:[-105,39],zoom:7,pitch:0}, {center:[-105,39],zoom:7,pitch:45}));
});

// Exercise frame lifecycle without GPU or network; UI tests separately cover
// MapLibre integration. Fake events represent accepted and failed raster tiles.
const {WeatherMap} = await import('../src/map-view.js');
function rendererFixture() {
  const sources = new Map(), layers = new Map(), listeners = new Map(), statuses = [];
  const map = {
    outcome: 'success',
    addSource(id, source) { sources.set(id, source); },
    addLayer(layer) {
      layers.set(layer.id, layer);
      const outcome = this.outcome;
      if (outcome === 'pending') return;
      queueMicrotask(() => {
        if (outcome === 'metadata-error') emit('sourcedata', {sourceId: layer.id, sourceDataType: 'content'});
        emit(outcome === 'error' || outcome === 'metadata-error' ? 'error' : 'sourcedata', outcome === 'error' || outcome === 'metadata-error'
          ? {sourceId: layer.id, error: new Error('Tile missing')}
          : {sourceId: layer.id, tile: {state: 'loaded', texture: {}}});
      });
    },
    getLayer(id) { return layers.get(id); },
    getSource(id) { return sources.get(id); },
    removeLayer(id) { layers.delete(id); },
    removeSource(id) { sources.delete(id); },
    setPaintProperty(id, property, value) { layers.get(id).paint[property] = value; },
    isSourceLoaded(id) { return sources.has(id); },
    on(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    off(type, listener) { listeners.get(type)?.delete(listener); },
  };
  function emit(type, event) { for (const listener of [...listeners.get(type) || []]) listener(event); }
  const renderer = Object.assign(Object.create(WeatherMap.prototype), {
    ready: Promise.resolve(true), destroyed: false, generation: 0, serial: 0,
    sources: new Set(), displayed: null, map, apiBase: '', onStatus: status => statuses.push(status),
  });
  const product = {id: 'radar', name: 'Fixture mosaic', source: 'Synthetic fixture', frames: Array.from({length: 40}, (_, index) => ({id: `f${index}`, time: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), verified: true}))};
  return {renderer, map, sources, layers, listeners, statuses, product};
}

test('failed frame retains actual displayed pixels and timestamp', async () => {
  const f = rendererFixture();
  assert.equal(await f.renderer.setProduct(f.product, 'f0'), true);
  f.map.outcome = 'error';
  assert.equal(await f.renderer.setProduct(f.product, 'f1'), false);
  assert.equal(f.renderer.displayed.frame.id, 'f0');
  assert.equal(f.statuses.at(-1).frameId, 'f0');
  assert.equal(f.statuses.at(-1).time, f.product.frames[0].time);
  assert.equal(f.statuses.at(-1).requestedFrameId, 'f1');
  assert.equal(f.sources.size, 1);
});

test('repeated cached playback retains one raster and no per-frame listeners', async () => {
  const f = rendererFixture();
  for (const frame of f.product.frames) assert.equal(await f.renderer.setProduct(f.product, frame.id), true);
  assert.equal(f.sources.size, 1);
  assert.equal(f.layers.size, 1);
  assert.equal(f.renderer.sources.size, 1);
  assert.equal([...f.listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
  assert.equal(f.renderer.displayed.frame.id, 'f39');
});

test('superseded frame request cannot replace the newer completed frame', async () => {
  const f = rendererFixture();
  f.map.outcome = 'pending';
  const old = f.renderer.setProduct(f.product, 'f0');
  await new Promise(resolve => setImmediate(resolve));
  f.map.outcome = 'success';
  const latest = f.renderer.setProduct(f.product, 'f1');
  assert.equal(await old, false);
  assert.equal(await latest, true);
  assert.equal(f.renderer.displayed.frame.id, 'f1');
  assert.equal(f.sources.size, 1);
  assert.equal([...f.listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
});


test('source-level content metadata never establishes successful raster loading', async () => {
  const f = rendererFixture();
  assert.equal(await f.renderer.setProduct(f.product, 'f0'), true);
  f.map.outcome = 'metadata-error';
  assert.equal(await f.renderer.setProduct(f.product, 'f1'), false);
  assert.equal(f.renderer.displayed.frame.id, 'f0');
  assert.equal(f.statuses.at(-1).state, 'error');
  assert.equal(f.statuses.at(-1).time, f.product.frames[0].time);
  assert.equal(f.sources.size, 1);
});
