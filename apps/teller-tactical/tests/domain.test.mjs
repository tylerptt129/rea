import test from 'node:test';
import assert from 'node:assert/strict';
import {
  celsiusToFahrenheit, fahrenheitToCelsius, metersToFeet, feetToMeters,
  mmToInches, metersPerSecondToMph, degreesToCardinal, validatePoint,
  tileBBox, WEB_MERCATOR_LIMIT, lonLatToMercator, mercatorToLonLat,
  formatTime, ageMinutes, parseDuration, parseValidTime, accumulateGrid,
  gridValueAt, isAlertActive, stormIngredients,
} from '../src/domain.mjs';

const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
const START = '2026-01-15T18:00:00Z';
const at = (hours) => new Date(Date.parse(START) + hours * 3600000).toISOString();
const grid = (values, uom = 'wmoUnit:mm') => ({ uom, values });

test('unit conversions preserve zero, source precision and missing values', () => {
  assert.equal(celsiusToFahrenheit(0), 32);
  assert.equal(celsiusToFahrenheit(-40), -40);
  close(fahrenheitToCelsius(32), 0);
  close(metersToFeet(feetToMeters(9200)), 9200);
  close(mmToInches(25.4), 1);
  close(metersPerSecondToMph(0.44704), 1);
  assert.equal(degreesToCardinal(0), 'N');
  assert.equal(degreesToCardinal(360), 'N');
  assert.equal(degreesToCardinal(-90), 'W');
  for (const value of [null, undefined, NaN, Infinity, '10']) {
    assert.equal(celsiusToFahrenheit(value), null);
    assert.equal(mmToInches(value), null);
  }
});

test('coordinate validation never invents a property point from missing values', () => {
  assert.deepEqual(validatePoint(38.8339, -104.8214), { latitude: 38.8339, longitude: -104.8214 });
  for (const pair of [[null, 0], [0, undefined], [91, 0], [0, -181], [NaN, 0], ['38', -104]]) assert.throws(() => validatePoint(...pair), RangeError);
});

test('Web Mercator XYZ bounds use a north-down Y axis with metre units', () => {
  assert.deepEqual(tileBBox(0, 0, 0), [-WEB_MERCATOR_LIMIT, -WEB_MERCATOR_LIMIT, WEB_MERCATOR_LIMIT, WEB_MERCATOR_LIMIT]);
  assert.deepEqual(tileBBox(1, 0, 0), [-WEB_MERCATOR_LIMIT, 0, 0, WEB_MERCATOR_LIMIT]);
  assert.deepEqual(tileBBox(1, 1, 1), [0, -WEB_MERCATOR_LIMIT, WEB_MERCATOR_LIMIT, 0]);
  for (const coords of [[-1,0,0],[0,1,0],[2,0,-1],[1,0.5,0],[23,0,0]]) assert.throws(() => tileBBox(...coords), RangeError);
});

test('geographic registration round-trips Colorado Springs and rejects polar singularities', () => {
  const [x, y] = lonLatToMercator(-104.8214, 38.8339);
  close(x, -11668664.872238047, 1e-5);
  assert.ok(y > 4_600_000 && y < 4_800_000);
  const [longitude, latitude] = mercatorToLonLat(x, y);
  close(longitude, -104.8214);
  close(latitude, 38.8339);
  assert.throws(() => lonLatToMercator(0, 90), RangeError);
  assert.throws(() => mercatorToLonLat(Infinity, 0), RangeError);
});

test('America/Denver formatting distinguishes both sides of DST clock changes', () => {
  assert.match(formatTime('2026-03-08T08:59:00Z'), /01:59.*MST/);
  assert.match(formatTime('2026-03-08T09:00:00Z'), /03:00.*MDT/);
  assert.match(formatTime('2026-11-01T07:30:00Z'), /01:30.*MDT/);
  assert.match(formatTime('2026-11-01T08:30:00Z'), /01:30.*MST/);
  assert.equal(formatTime('2026-01-15T12:00:00'), '—');
  assert.equal(formatTime('invalid'), '—');
  assert.equal(ageMinutes(START, Date.parse(at(1))), 60);
});

test('forecast interval parser respects explicit UTC offsets and refuses calendar-month guesses', () => {
  assert.equal(parseDuration('PT6H'), 6 * 3600000);
  assert.equal(parseDuration('P1DT30M'), 24.5 * 3600000);
  assert.equal(parseDuration('P1M'), null);
  assert.equal(parseDuration('P0D'), null);
  assert.equal(parseValidTime(`${START}/PT6H`).endIso, at(6));
  assert.equal(parseValidTime(`PT6H/${at(6)}`).startIso, at(0));
  assert.equal(parseValidTime(`${START}/${at(6)}`).durationMs, 6 * 3600000);
  assert.equal(parseValidTime('2026-01-15T18:00:00/PT6H'), null);
  assert.equal(parseValidTime(`${START}/P1M`), null);
});

test('precipitation accumulation only sums a complete exact source interval window', () => {
  const source = grid([{ validTime: `${at(0)}/PT6H`, value: 1.25 }, { validTime: `${at(6)}/PT6H`, value: 0 }, { validTime: `${at(12)}/PT6H`, value: 2.5 }]);
  const result = accumulateGrid(source, at(0), at(12));
  assert.equal(result.complete, true);
  assert.equal(result.total, 1.25);
  assert.equal(result.intervalCount, 2);
  assert.equal(result.coverageFraction, 1);
  assert.equal(result.uom, 'wmoUnit:mm');
  assert.equal(source.values[0].value, 1.25);
});

test('precipitation window crossing a cycle/interval boundary is never prorated', () => {
  const source = grid([{ validTime: `${at(0)}/PT6H`, value: 12 }, { validTime: `${at(6)}/PT6H`, value: 4 }]);
  const partial = accumulateGrid(source, at(3), at(9));
  assert.equal(partial.complete, false);
  assert.equal(partial.total, null);
  assert.equal(partial.knownTotal, null);
  assert.equal(partial.excludedPartialIntervals, 2);
  const complete = accumulateGrid(source, at(0), at(12));
  assert.equal(complete.total, 16);
});

test('overlaps, gaps, missing and negative accumulations do not become apparently valid totals', () => {
  const overlap = accumulateGrid(grid([{ validTime: `${at(0)}/PT6H`, value: 2 }, { validTime: `${at(3)}/PT3H`, value: 1 }]), at(0), at(6));
  assert.equal(overlap.total, null);
  assert.equal(overlap.knownTotal, null);
  assert.match(overlap.errors.join(' '), /Overlapping/);
  const gap = accumulateGrid(grid([{ validTime: `${at(0)}/PT3H`, value: 2 }, { validTime: `${at(6)}/PT6H`, value: 1 }]), at(0), at(12));
  assert.equal(gap.complete, false);
  assert.equal(gap.knownTotal, 3);
  for (const value of [null, NaN, -1]) {
    const result = accumulateGrid(grid([{ validTime: `${at(0)}/PT6H`, value }]), at(0), at(6));
    assert.equal(result.total, null);
    assert.equal(result.missingIntervals, 1);
  }
  assert.equal(accumulateGrid(null, at(0), at(6)).total, null);
  assert.throws(() => accumulateGrid(grid([]), at(6), at(0)), RangeError);
});

test('grid lookup uses half-open valid intervals and preserves source missing values', () => {
  const source = grid([{ validTime: `${at(0)}/PT6H`, value: 0 }, { validTime: `${at(6)}/PT6H`, value: null }]);
  assert.equal(gridValueAt(source, at(0)).value, 0);
  assert.equal(gridValueAt(source, at(6)).value, null);
  assert.equal(gridValueAt(source, at(12)), null);
});

test('official alert expiry is required and cancelled/test/exercise alerts are not active', () => {
  const alert = { properties: { expires: at(1), status: 'Actual', messageType: 'Alert' } };
  assert.equal(isAlertActive(alert, Date.parse(at(0))), true);
  assert.equal(isAlertActive(alert, Date.parse(at(1))), false);
  assert.equal(isAlertActive({ expires: 'invalid' }, Date.parse(at(0))), false);
  assert.equal(isAlertActive({ ...alert.properties, status: 'Test' }, Date.parse(at(0))), false);
  assert.equal(isAlertActive({ ...alert.properties, status: 'Exercise' }, Date.parse(at(0))), false);
  assert.equal(isAlertActive({ ...alert.properties, messageType: 'Cancel' }, Date.parse(at(0))), false);
});

test('storm ingredients expose available inputs and elevation mismatch without invented forecasts', () => {
  const source = { point: { gridElevationM: 2500 }, grids: { temperature: grid([{ validTime: `${at(0)}/PT6H`, value: -4 }], 'wmoUnit:degC') } };
  const result = stormIngredients(source, { elevationFt: 9200, now: Date.parse(at(1)) });
  assert.equal(result.ingredients.length, 1);
  assert.equal(result.ingredients[0].value, -4);
  assert.ok(result.unavailable.includes('Forecast snow level'));
  close(result.elevationDifferenceM, 304.16);
  assert.match(result.method, /no upslope threshold, snow ratio, or confidence/);
  assert.equal(stormIngredients(source).elevationDifferenceM, null);
});
