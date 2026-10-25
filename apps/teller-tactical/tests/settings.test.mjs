import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, normalizeProperty, normalizeCamera, DEFAULT_SETTINGS, isPropertyPoint, propertyElevationForPoint } from '../src/settings.mjs';

const camera = { center: [-105.08, 38.98], zoom: 7.4 };
const property = { latitude: 38.98, longitude: -105.08, elevationFt: 9200 };

test('absent or malformed settings always restore complete safe renderer defaults', () => {
  for (const value of [null, undefined, 'bad', [], 99]) {
    const result = normalizeSettings(value);
    assert.equal(result.theme, 'dark');
    assert.equal(result.layout, 1);
    assert.equal(result.speed, 500);
    assert.equal(result.property, null);
    assert.deepEqual(result.camera, camera);
    assert.deepEqual(result.views, []);
  }
});

test('saved settings preserve legitimate choices without coercing unknown input types', () => {
  const result = normalizeSettings({ theme: 'light', layout: 4, linkCamera: false, linkTime: false, opacity: 0, speed: 1000, showAlerts: false, showObservations: false, layersOpen: false, weatherOpen: false, property, camera });
  assert.equal(result.theme, 'light');
  assert.equal(result.layout, 4);
  assert.equal(result.opacity, 0);
  assert.equal(result.speed, 1000);
  for (const name of ['linkCamera','linkTime','showAlerts','showObservations','layersOpen','weatherOpen']) assert.equal(result[name], false);
  assert.deepEqual(result.property, property);
  assert.equal(normalizeSettings({ linkCamera: 'false' }).linkCamera, true);
  assert.equal(normalizeSettings({ layout: '4', speed: null }).layout, 1);
  assert.equal(normalizeSettings({ layout: '4', speed: null }).speed, 500);
});

test('camera normalization prevents invalid saved geometry from breaking map startup', () => {
  for (const value of [null, {}, { center: [null,null], zoom: 4 }, { center: [0,90], zoom: 2 }, { center: [181,0], zoom: 3 }, { center: [0,0], zoom: NaN }]) assert.deepEqual(normalizeCamera(value), camera);
  const result = normalizeCamera({ center: [0,0], zoom: 500, bearing: 725, pitch: -10 });
  assert.deepEqual(result, { center: [0,0], zoom: 15, bearing: 5, pitch: 0 });
  assert.equal(normalizeCamera({ center: [0,0], zoom: -5, pitch: 100 }).pitch, 60);
  assert.equal(normalizeCamera({ center: [0,0], zoom: -5, pitch: 100 }).zoom, 2);
});

test('broken saved-view entries are removed while valid views remain bounded and independent', () => {
  const source = { views: [null, {}, { name: 'No camera' }, { name: 'Bad camera', camera: { center: [NaN,NaN], zoom: 4 } }, { name: '  Property  ', camera }] };
  const result = normalizeSettings(source);
  assert.equal(result.views.length, 1);
  assert.equal(result.views[0].name, 'Property');
  result.views[0].camera.center[0] = 0;
  assert.equal(camera.center[0], -105.08);
  assert.equal(normalizeSettings({ views: Array.from({ length: 30 }, (_, i) => ({ name: `View ${i}`, camera })) }).views.length, 20);
});

test('invalid saved property data stays unset rather than becoming an invented point/elevation', () => {
  for (const value of [null, {}, { ...property, latitude: '' }, { ...property, longitude: null }, { ...property, elevationFt: '9200' }, { ...property, elevationFt: 30001 }, { ...property, latitude: NaN }]) assert.equal(normalizeProperty(value), null);
  assert.deepEqual(normalizeProperty(property), property);
});

test('property elevation is available only for the actual property forecast point', () => {
  assert.equal(isPropertyPoint(property, { latitude: 38.98, longitude: -105.08 }), true);
  assert.equal(isPropertyPoint(property, { latitude: 38.98 + 1e-8, longitude: -105.08 }), true);
  assert.equal(isPropertyPoint(property, { latitude: 38.8339, longitude: -104.8214 }), false);
  assert.equal(propertyElevationForPoint({ property }, { latitude: 38.98, longitude: -105.08 }), 9200);
  assert.equal(propertyElevationForPoint({ property }, { latitude: 38.8339, longitude: -104.8214 }), null);
  assert.equal(propertyElevationForPoint({ property: null }, property), null);
});

test('normalization discards unknown keys and does not mutate shared defaults or caller objects', () => {
  const saved = JSON.parse('{"theme":"light","__proto__":{"unsafe":true},"other":99}');
  const result = normalizeSettings(saved);
  assert.equal(Object.hasOwn(result, 'other'), false);
  assert.equal(Object.hasOwn(result, '__proto__'), false);
  result.camera.center[0] = 0;
  result.views.push({ name: 'Local' });
  assert.equal(DEFAULT_SETTINGS.camera.center[0], -105.08);
  assert.equal(DEFAULT_SETTINGS.views.length, 0);
  assert.equal(saved.theme, 'light');
});
