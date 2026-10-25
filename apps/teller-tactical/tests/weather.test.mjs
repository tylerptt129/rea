import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPoint, fetchSites, nwsUrl, quantity, normalizeAlerts, normalizeObservation, normalizeGrids, fixturePoint, fixtureSites } from '../server/weather.mjs';

const NOW = Date.parse('2026-01-15T18:00:00Z');
const BASE = 'https://api.weather.gov';
const response = (data, stale = false) => ({ data, retrievedAt: '2026-01-15T18:00:00Z', stale });
function clientFor(overrides = {}) {
  const calls = [];
  const station = { type: 'Feature', id: `${BASE}/stations/KCOS`, geometry: { type: 'Point', coordinates: [-104.7, 38.8] }, properties: { stationIdentifier: 'KCOS', name: 'Colorado Springs', elevation: { value: 1880, unitCode: 'wmoUnit:m' } } };
  const table = {
    [`${BASE}/points/38.8339,-104.8214`]: response({ properties: { relativeLocation: { properties: { city: 'Colorado Springs', state: 'CO' } }, timeZone: 'America/Denver', gridId: 'PUB', gridX: 91, gridY: 53, forecast: `${BASE}/gridpoints/PUB/91,53/forecast`, forecastHourly: `${BASE}/gridpoints/PUB/91,53/forecast/hourly`, forecastGridData: `${BASE}/gridpoints/PUB/91,53`, observationStations: `${BASE}/gridpoints/PUB/91,53/stations` } }),
    [`${BASE}/alerts/active?point=38.8339,-104.8214`]: response({ features: [
      { type: 'Feature', id: 'active', geometry: null, properties: { event: 'Winter Storm Warning', status: 'Actual', messageType: 'Alert', expires: '2026-01-16T18:00:00Z', sent: '2026-01-15T16:00:00Z', description: 'Official source text' } },
      { type: 'Feature', id: 'expired', properties: { expires: '2026-01-15T17:00:00Z' } },
    ] }),
    [`${BASE}/gridpoints/PUB/91,53/forecast`]: response({ properties: { updateTime: '2026-01-15T16:00:00Z', elevation: { value: 2500, unitCode: 'wmoUnit:m' }, periods: [{ number: 1, temperature: 25, temperatureUnit: 'F', startTime: '2026-01-15T18:00:00Z', endTime: '2026-01-16T06:00:00Z' }] } }),
    [`${BASE}/gridpoints/PUB/91,53/forecast/hourly`]: response({ properties: { updateTime: '2026-01-15T16:00:00Z', periods: [{ number: 1, temperature: 25, temperatureUnit: 'F' }] } }),
    [`${BASE}/gridpoints/PUB/91,53`]: response({ properties: { updateTime: '2026-01-15T16:05:00Z', elevation: { value: 2510, unitCode: 'wmoUnit:m' }, validTimes: '2026-01-15T18:00:00Z/PT24H', quantitativePrecipitation: { uom: 'wmoUnit:mm', values: [{ validTime: '2026-01-15T18:00:00Z/PT6H', value: 5.125 }] }, snowfallAmount: { uom: 'wmoUnit:mm', values: [{ validTime: '2026-01-15T18:00:00Z/PT6H', value: null }] }, weather: { values: [{ validTime: '2026-01-15T18:00:00Z/PT6H', value: [{ weather: 'snow', coverage: 'chance' }] }] } } }),
    [`${BASE}/gridpoints/PUB/91,53/stations`]: response({ features: [station] }),
    [`${BASE}/stations/KCOS/observations/latest`]: response({ id: 'latest', geometry: station.geometry, properties: { timestamp: '2026-01-15T17:45:00Z', temperature: { value: 0, unitCode: 'wmoUnit:degC', qualityControl: 'V' }, windSpeed: { value: 36, unitCode: 'wmoUnit:km_h-1' }, windDirection: { value: 90, unitCode: 'wmoUnit:degree_(angle)' }, textDescription: 'Light snow' } }),
    ...overrides,
  };
  return { calls, async json(url, options) {
    calls.push({ url, options });
    if (!(url in table)) throw new Error(`Unexpected URL ${url}`);
    const item = table[url];
    if (item instanceof Error) throw item;
    return structuredClone(item);
  } };
}

test('point adapter discovers NWS links and retains forecast/grid/observation provenance and precision', async () => {
  const client = clientFor();
  const result = await fetchPoint(38.8339, -104.8214, { client, now: NOW });
  assert.equal(result.errors.length, 0);
  assert.equal(result.fixture, false);
  assert.equal(result.point.description, 'Colorado Springs, CO');
  assert.equal(result.point.elevationM, null);
  assert.equal(result.point.gridElevationM, 2510);
  assert.equal(result.forecastUpdated, '2026-01-15T16:00:00Z');
  assert.equal(result.modelInitialization, null);
  assert.equal(result.gridUpdated, '2026-01-15T16:05:00Z');
  assert.equal(result.grids.quantitativePrecipitation.values[0].value, 5.125);
  assert.equal(result.grids.snowfallAmount.values[0].value, null);
  assert.equal(result.grids.weather.values[0].value[0].weather, 'snow');
  assert.equal(result.observations[0].temperatureC, 0);
  assert.equal(result.observations[0].temperatureF, 32);
  assert.equal(result.observations[0].elevationM, 1880);
  assert.equal(result.observations[0].windSpeedMps, 10);
  assert.equal(result.observations[0].qualityFlags.temperature, 'V');
  assert.equal(result.observations[0].latitude, 38.8);
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].description, 'Official source text');
  assert.equal(result.alertStatus.expired, 1);
  assert.equal(result.sources.length, 7);
  assert.ok(client.calls.every(({ options }) => options.ttl > 0));
});

test('partial source interruption preserves successful peer forecasts and labels stale source data', async () => {
  const client = clientFor({
    [`${BASE}/gridpoints/PUB/91,53/forecast/hourly`]: new Error('Timeout waiting for source'),
    [`${BASE}/gridpoints/PUB/91,53`]: response({ properties: { updateTime: '2026-01-15T14:00:00Z', temperature: { uom: 'wmoUnit:degC', values: [{ validTime: '2026-01-15T18:00:00Z/PT6H', value: -4 }] } } }, true),
  });
  const result = await fetchPoint(38.8339, -104.8214, { client, now: NOW });
  assert.equal(result.periods.length, 1);
  assert.equal(result.hourly.length, 0);
  assert.equal(result.observations.length, 1);
  assert.equal(result.stale, true);
  assert.match(result.errors.join(' '), /Hourly forecast: Timeout/);
  assert.equal(result.sources.find(({ name }) => name === 'forecast-grid').stale, true);
});

test('failed point discovery still returns official alert results without invented forecasts', async () => {
  const client = clientFor({ [`${BASE}/points/38.8339,-104.8214`]: new Error('Network unavailable') });
  const result = await fetchPoint(38.8339, -104.8214, { client, now: NOW });
  assert.equal(result.alerts.length, 1);
  assert.equal(result.periods.length, 0);
  assert.deepEqual(result.grids, {});
  assert.match(result.errors.join(' '), /Point discovery: Network unavailable/);
});

test('malformed NWS discovery cannot redirect backend requests to other hosts or credentials', async () => {
  for (const url of ['https://evil.example/grid', 'https://api.weather.gov.evil.example/', 'https://user:pass@api.weather.gov/points/1,2', 'http://api.weather.gov/points/1,2', 'https://api.weather.gov:444/']) assert.throws(() => nwsUrl(url), TypeError);
  const client = clientFor({ [`${BASE}/points/38.8339,-104.8214`]: response({ properties: { forecast: 'https://evil.example/forecast' } }) });
  const result = await fetchPoint(38.8339, -104.8214, { client, now: NOW });
  assert.match(result.errors.join(' '), /outside https:\/\/api.weather.gov/);
  assert.ok(client.calls.every(({ url }) => new URL(url).hostname === 'api.weather.gov'));
});

test('observation station fanout is bounded to three and failed station does not erase peers', async () => {
  const stations = Array.from({ length: 10 }, (_, index) => ({ id: `${BASE}/stations/KC${index}X`, geometry: { type: 'Point', coordinates: [-104, 38] }, properties: { stationIdentifier: `KC${index}X` } }));
  const client = clientFor({
    [`${BASE}/gridpoints/PUB/91,53/stations`]: response({ features: stations }),
    [`${BASE}/stations/KC0X/observations/latest`]: response({ properties: { timestamp: '2026-01-15T17:00:00Z' } }),
    [`${BASE}/stations/KC1X/observations/latest`]: new Error('Bad observation'),
    [`${BASE}/stations/KC2X/observations/latest`]: response({ properties: { timestamp: '2026-01-15T17:00:00Z' } }),
  });
  const result = await fetchPoint(38.8339, -104.8214, { client, now: NOW });
  assert.equal(result.observations.length, 2);
  assert.equal(client.calls.filter(({ url }) => url.endsWith('/observations/latest')).length, 3);
  assert.match(result.errors.join(' '), /Bad observation/);
});

test('unknown observation units and missing values remain null rather than plausible numbers', () => {
  assert.equal(quantity({ value: 99, unitCode: 'wmoUnit:unknown' }, 'C'), null);
  assert.equal(quantity({ value: null, unitCode: 'wmoUnit:degC' }, 'C'), null);
  assert.equal(quantity({ value: NaN, unitCode: 'wmoUnit:m' }, 'm'), null);
  assert.equal(quantity({ value: 32, unitCode: 'wmoUnit:degF' }, 'C'), 0);
  assert.equal(quantity({ value: 1000, unitCode: 'wmoUnit:ft' }, 'm'), 304.8);
  const result = normalizeObservation({ properties: { temperature: { value: 10, unitCode: 'unknown', qualityControl: 'X' } } });
  assert.equal(result.temperatureC, null);
  assert.equal(result.latitude, null);
  assert.equal(result.qualityFlags.temperature, 'X');
  assert.equal(result.properties.temperature.value, 10);
});

test('invalid/missing alert expiration is counted, not presented as active', () => {
  const result = normalizeAlerts({ features: [{ properties: { expires: null } }, { properties: { expires: 'nonsense' } }] }, NOW);
  assert.deepEqual(result, { active: [], expired: 0, unknownExpiry: 2 });
});

test('radar site normalization retains real coordinates and rejects malformed entries', async () => {
  const client = { async json(url, options) {
    assert.equal(url, `${BASE}/radar/stations?stationType=WSR-88D`);
    assert.equal(options.ttl, 86400000);
    return response({ features: [
      { id: `${BASE}/radar/stations/KPUX`, geometry: { type: 'Point', coordinates: [-104.1814, 38.4595] }, properties: { name: 'Pueblo', elevation: { value: 1600, unitCode: 'wmoUnit:m' } } },
      { id: 'bad', geometry: { type: 'Point', coordinates: [null, null] }, properties: {} },
    ] });
  } };
  const result = await fetchSites({ client });
  assert.equal(result.fixture, false);
  assert.equal(result.sites.length, 1);
  assert.equal(result.sites[0].id, 'KPUX');
  assert.equal(result.sites[0].latitude, 38.4595);
  await assert.rejects(fetchSites({ client: { json: async () => response({ features: [] }) } }), /no usable station/);
});

test('fixture mode is explicit and deterministic, separate from all production requests', () => {
  const first = fixturePoint();
  const second = fixturePoint();
  assert.deepEqual(first, second);
  assert.equal(first.fixture, true);
  assert.match(first.forecastSource, /fixture/);
  assert.equal(fixtureSites().fixture, true);
  assert.equal(first.modelInitialization, null);
  assert.equal(first.grids.quantitativePrecipitation.values.length, 4);
  assert.equal(normalizeGrids({ ignoredField: { values: [1] } }).ignoredField, undefined);
});
