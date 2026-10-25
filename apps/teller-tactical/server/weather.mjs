import { validatePoint, isAlertActive, celsiusToFahrenheit, feetToMeters } from '../src/domain.mjs';

const ORIGIN = 'https://api.weather.gov';
const numeric = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = (value) => Array.isArray(value) ? value : [];
const iso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const message = (cause) => cause instanceof Error ? cause.message.slice(0, 300) : 'Source request failed';

export function nwsUrl(value) {
  if (typeof value !== 'string') throw new TypeError('NWS response omitted a required source URL.');
  const url = new URL(value);
  if (url.origin !== ORIGIN || url.username || url.password || url.hash)
    throw new TypeError('Refusing a forecast discovery URL outside https://api.weather.gov.');
  return url.href;
}

/** Convert known units only, keeping the complete raw quantitative value elsewhere. */
export function quantity(value, expected) {
  const field = object(value);
  const amount = numeric(field.value);
  if (amount === null) return null;
  const unit = String(field.unitCode ?? '').split(':').at(-1);
  if (expected === 'm') {
    if (unit === 'm') return amount;
    if (unit === 'ft') return feetToMeters(amount);
  }
  if (expected === 'C') {
    if (['degC', 'Cel'].includes(unit)) return amount;
    if (['degF', '[degF]'].includes(unit)) return (amount - 32) * 5 / 9;
    if (unit === 'K') return amount - 273.15;
  }
  if (expected === 'm/s') {
    if (['m_s-1','m/s'].includes(unit)) return amount;
    if (['km_h-1','km/h'].includes(unit)) return amount / 3.6;
    if (['mi_h-1','[mi_i]/h'].includes(unit)) return amount * 0.44704;
    if (['kt','[kn_i]'].includes(unit)) return amount * 1852 / 3600;
  }
  if (expected === 'degree' && ['degree_(angle)','deg'].includes(unit)) return amount;
  if (expected === '%' && unit === 'percent') return amount;
  return null;
}

const coordinateOf = (feature) => {
  const geometry = object(feature?.geometry);
  if (geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) return { latitude: null, longitude: null };
  const [longitude, latitude] = geometry.coordinates;
  try { return validatePoint(latitude, longitude); } catch { return { latitude: null, longitude: null }; }
};
const sourceRecord = (name, response, url) => ({
  name, sourceUrl: url, retrievedAt: response.retrievedAt ?? null,
  stale: response.stale === true,
});

export function normalizeObservation(feature, station = {}, response = {}, url = null) {
  const properties = object(feature?.properties);
  const stationProperties = object(station.properties);
  const observedPoint = coordinateOf(feature);
  const stationPoint = coordinateOf(station);
  const temperatureC = quantity(properties.temperature, 'C');
  return {
    id: feature?.id ?? properties['@id'] ?? url,
    stationId: stationProperties.stationIdentifier ?? station.id?.split('/').at(-1) ?? properties.station?.split('/').at(-1) ?? null,
    name: stationProperties.name ?? stationProperties.stationIdentifier ?? 'NWS observation station',
    latitude: observedPoint.latitude ?? stationPoint.latitude,
    longitude: observedPoint.longitude ?? stationPoint.longitude,
    elevationM: quantity(properties.elevation, 'm') ?? quantity(stationProperties.elevation, 'm'),
    timestamp: iso(properties.timestamp), observedAt: iso(properties.timestamp),
    textDescription: typeof properties.textDescription === 'string' ? properties.textDescription : '',
    temperatureC, temperatureF: celsiusToFahrenheit(temperatureC),
    windSpeedMps: quantity(properties.windSpeed, 'm/s'),
    windDirectionDeg: quantity(properties.windDirection, 'degree'),
    relativeHumidity: quantity(properties.relativeHumidity, '%'),
    properties, geometry: feature?.geometry ?? station.geometry ?? null,
    sourceUrl: url, retrievedAt: response.retrievedAt ?? null, stale: response.stale === true,
    qualityFlags: Object.fromEntries(Object.entries(properties).filter(([, field]) => field && typeof field === 'object' && 'qualityControl' in field).map(([name, field]) => [name, field.qualityControl])),
  };
}

export function normalizeAlerts(collection, now = Date.now()) {
  const features = list(collection?.features);
  const active = [];
  let expired = 0;
  let unknownExpiry = 0;
  for (const feature of features) {
    const properties = object(feature?.properties);
    if (!iso(properties.expires)) { unknownExpiry += 1; continue; }
    if (!isAlertActive(feature, now)) { expired += 1; continue; }
    active.push({
      type: 'Feature', id: feature.id ?? properties.id ?? null,
      geometry: feature.geometry ?? null, properties,
      event: properties.event ?? 'Weather alert', headline: properties.headline ?? '',
      severity: properties.severity ?? 'Unknown', sent: iso(properties.sent),
      expires: iso(properties.expires), ends: iso(properties.ends),
      description: properties.description ?? '', instruction: properties.instruction ?? '',
      sourceUrl: typeof feature.id === 'string' ? feature.id : properties['@id'] ?? null,
    });
  }
  return { active, expired, unknownExpiry };
}

const GRID_FIELDS = ['quantitativePrecipitation','snowfallAmount','snowLevel','temperature','dewpoint','relativeHumidity','windSpeed','windDirection','windGust','probabilityOfPrecipitation','weather','skyCover'];
export function normalizeGrids(properties) {
  const grids = {};
  for (const name of GRID_FIELDS) {
    const field = properties?.[name];
    if (!field || !Array.isArray(field.values)) continue;
    grids[name] = {
      uom: typeof field.uom === 'string' ? field.uom : null,
      values: field.values.filter((entry) => typeof entry?.validTime === 'string').map((entry) => ({ ...entry })),
    };
  }
  return grids;
}

/**
 * NWS point discovery is authoritative. Partial failures are retained explicitly;
 * a successful alerts request must not disappear because hourly forecasts fail.
 */
export async function fetchPoint(latitude, longitude, { client, signal, now = Date.now() } = {}) {
  validatePoint(latitude, longitude);
  if (!client || typeof client.json !== 'function') throw new TypeError('A bounded source client is required.');
  const result = {
    point: { latitude, longitude, elevationM: null, gridElevationM: null, description: 'Selected location', timeZone: 'America/Denver' },
    retrievedAt: new Date(now).toISOString(), forecastUpdated: null, gridUpdated: null,
    periods: [], hourly: [], observations: [], alerts: [], grids: {},
    errors: [], sources: [], stale: false, fixture: false,
    forecastSource: 'National Weather Service', modelInitialization: null,
    limitations: [
      'Official NWS gridded forecast, not a property-specific prediction or independently selected numerical model.',
      'Issue/update timestamps are not numerical model initialization times. Source model-cycle selection is unavailable.',
      'Point API coverage is limited to the United States and supported NWS forecast areas.',
    ],
    alertStatus: { expired: 0, unknownExpiry: 0 },
  };
  const read = async (name, url, ttl) => {
    const safeUrl = nwsUrl(url);
    const response = await client.json(safeUrl, { ttl, signal });
    result.sources.push(sourceRecord(name, response, safeUrl));
    result.stale ||= response.stale === true;
    return response;
  };
  const safe = async (name, task) => {
    try { return await task(); } catch (cause) {
      if (signal?.aborted) throw cause;
      result.errors.push(`${name}: ${message(cause)}`);
      return null;
    }
  };
  const pointUrl = `${ORIGIN}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  const alertUrl = `${ORIGIN}/alerts/active?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  const [pointResponse, alertResponse] = await Promise.all([
    safe('Point discovery', () => read('point-discovery', pointUrl, 24 * 60 * 60 * 1000)),
    safe('Official alerts', () => read('alerts', alertUrl, 60 * 1000)),
  ]);
  if (alertResponse) {
    const normalized = normalizeAlerts(alertResponse.data, now);
    result.alerts = normalized.active;
    result.alertStatus = { expired: normalized.expired, unknownExpiry: normalized.unknownExpiry };
    if (normalized.unknownExpiry) result.errors.push(`${normalized.unknownExpiry} alert(s) had unknown expiration and were not presented as active.`);
  }
  if (!pointResponse) return result;
  const point = object(pointResponse.data?.properties);
  const relative = object(point.relativeLocation?.properties);
  const location = [relative.city, relative.state].filter((entry) => typeof entry === 'string' && entry.length).join(', ');
  result.point.description = location || 'Selected location';
  result.point.timeZone = typeof point.timeZone === 'string' ? point.timeZone : 'America/Denver';
  result.point.gridId = point.gridId ?? null;
  result.point.gridX = numeric(point.gridX);
  result.point.gridY = numeric(point.gridY);
  const jobs = [
    safe('Forecast', async () => {
      const response = await read('forecast', point.forecast, 5 * 60 * 1000);
      const properties = object(response.data?.properties);
      if (!Array.isArray(properties.periods)) throw new TypeError('Forecast response omitted periods.');
      result.periods = properties.periods;
      result.forecastUpdated = iso(properties.updateTime) ?? iso(properties.updated) ?? iso(properties.generatedAt);
      result.forecastValidTimes = properties.validTimes ?? null;
      result.forecastSourceUrl = point.forecast;
      result.point.gridElevationM ??= quantity(properties.elevation, 'm');
    }),
    safe('Hourly forecast', async () => {
      const response = await read('hourly-forecast', point.forecastHourly, 5 * 60 * 1000);
      const properties = object(response.data?.properties);
      if (!Array.isArray(properties.periods)) throw new TypeError('Hourly forecast response omitted periods.');
      result.hourly = properties.periods;
      result.hourlyUpdated = iso(properties.updateTime) ?? iso(properties.updated) ?? iso(properties.generatedAt);
    }),
    safe('Forecast grid', async () => {
      const response = await read('forecast-grid', point.forecastGridData, 5 * 60 * 1000);
      const properties = object(response.data?.properties);
      if (Object.keys(properties).length === 0) throw new TypeError('Forecast grid response omitted properties.');
      result.grids = normalizeGrids(properties);
      result.gridUpdated = iso(properties.updateTime);
      result.gridValidTimes = properties.validTimes ?? null;
      result.gridSourceUrl = point.forecastGridData;
      result.point.gridElevationM = quantity(properties.elevation, 'm') ?? result.point.gridElevationM;
    }),
    safe('Nearby observations', async () => {
      const response = await read('observation-stations', point.observationStations, 24 * 60 * 60 * 1000);
      const collection = response.data;
      const features = list(collection?.features).slice(0, 3);
      const stations = features.length ? features : list(collection?.observationStations).slice(0, 3).map((url) => ({ id: url, properties: {} }));
      const observed = await Promise.all(stations.map((station, index) => safe(`Observation ${index + 1}`, async () => {
        const properties = object(station?.properties);
        const stationId = properties.stationIdentifier ?? (typeof station.id === 'string' ? new URL(nwsUrl(station.id)).pathname.split('/').at(-1) : null);
        if (typeof stationId !== 'string' || !/^[A-Za-z0-9-]{2,12}$/.test(stationId)) throw new TypeError('Station identifier is malformed.');
        const url = `${ORIGIN}/stations/${encodeURIComponent(stationId)}/observations/latest`;
        const observation = await read(`observation-${stationId}`, url, 5 * 60 * 1000);
        if (!observation.data?.properties) throw new TypeError('Observation response omitted properties.');
        return normalizeObservation(observation.data, station, observation, url);
      })));
      result.observations = observed.filter(Boolean);
    }),
  ];
  await Promise.all(jobs);
  return result;
}

export async function fetchSites({ client, signal } = {}) {
  if (!client || typeof client.json !== 'function') throw new TypeError('A bounded source client is required.');
  const url = `${ORIGIN}/radar/stations?stationType=WSR-88D`;
  const response = await client.json(url, { ttl: 24 * 60 * 60 * 1000, signal });
  if (!Array.isArray(response.data?.features)) throw new TypeError('NWS radar station response omitted GeoJSON features.');
  const sites = [];
  for (const feature of response.data.features) {
    const properties = object(feature?.properties);
    const coordinates = coordinateOf(feature);
    if (coordinates.latitude === null || coordinates.longitude === null) continue;
    const candidate = properties.stationIdentifier ?? properties.id ?? feature.id?.split('/').at(-1);
    if (typeof candidate !== 'string' || !/^[A-Za-z0-9]{3,4}$/.test(candidate)) continue;
    const id = candidate.toUpperCase();
    sites.push({ id, name: properties.name ?? id, ...coordinates, elevationM: quantity(properties.elevation, 'm'), sourceUrl: typeof feature.id === 'string' ? feature.id : url });
  }
  if (sites.length === 0) throw new TypeError('NWS radar response contained no usable station locations.');
  return { sites: sites.sort((a, b) => a.id.localeCompare(b.id)), retrievedAt: response.retrievedAt ?? null, stale: response.stale === true, sourceUrl: url, fixture: false };
}

/** Explicit deterministic data for UI/tests. Never called as a production fallback. */
export function fixtureSites() {
  return {
    fixture: true, stale: false, retrievedAt: '2026-01-15T18:00:00.000Z', sourceUrl: 'fixture://radar-sites',
    sites: [
      { id: 'KPUX', name: 'Pueblo, Colorado (fixture location)', latitude: 38.4595, longitude: -104.1814, elevationM: 1600, sourceUrl: 'fixture://KPUX' },
      { id: 'KFTG', name: 'Denver/Boulder, Colorado (fixture location)', latitude: 39.7866, longitude: -104.5458, elevationM: 1675, sourceUrl: 'fixture://KFTG' },
      { id: 'KGLD', name: 'Goodland, Kansas (fixture location)', latitude: 39.3667, longitude: -101.7, elevationM: 1100, sourceUrl: 'fixture://KGLD' },
    ],
  };
}
export function fixturePoint(latitude = 38.8339, longitude = -104.8214, now = Date.parse('2026-01-15T18:00:00Z')) {
  validatePoint(latitude, longitude);
  const start = new Date(now).toISOString();
  const end = new Date(now + 24 * 3600000).toISOString();
  const periods = Array.from({ length: 8 }, (_, i) => ({
    number: i + 1, name: i === 0 ? 'Fixture afternoon' : `Fixture period ${i + 1}`,
    startTime: new Date(now + i * 12 * 3600000).toISOString(), endTime: new Date(now + (i + 1) * 12 * 3600000).toISOString(),
    isDaytime: i % 2 === 0, temperature: i % 2 === 0 ? 25 + i : 11 + i, temperatureUnit: 'F',
    windSpeed: '10 to 20 mph', windDirection: 'NE', shortForecast: i % 2 === 0 ? 'Fixture snow showers' : 'Fixture mostly cloudy',
    detailedForecast: 'SYNTHETIC TEST FIXTURE. No live forecast is represented. Example snow and northeasterly winds demonstrate the display only.',
    probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 60 },
  }));
  const values = (value, uom) => ({ uom, values: [{ validTime: `${start}/PT24H`, value }] });
  const grids = {
    quantitativePrecipitation: { uom: 'wmoUnit:mm', values: Array.from({ length: 4 }, (_, i) => ({ validTime: `${new Date(now + i * 6 * 3600000).toISOString()}/PT6H`, value: [1, 3, 2, 0][i] })) },
    snowfallAmount: { uom: 'wmoUnit:mm', values: Array.from({ length: 4 }, (_, i) => ({ validTime: `${new Date(now + i * 6 * 3600000).toISOString()}/PT6H`, value: [10, 30, 15, 0][i] })) },
    temperature: values(-4, 'wmoUnit:degC'), dewpoint: values(-6, 'wmoUnit:degC'), relativeHumidity: values(85, 'wmoUnit:percent'),
    windSpeed: values(25, 'wmoUnit:km_h-1'), windDirection: values(45, 'wmoUnit:degree_(angle)'), snowLevel: values(1800, 'wmoUnit:m'),
    weather: values([{ coverage: 'chance', weather: 'snow', intensity: 'light', attributes: [] }], null),
  };
  const station = { id: `${ORIGIN}/stations/KCOS`, type: 'Feature', geometry: { type: 'Point', coordinates: [-104.6889, 38.8056] }, properties: { stationIdentifier: 'KCOS', name: 'Colorado Springs (fixture)', elevation: { value: 1884, unitCode: 'wmoUnit:m' } } };
  const observation = normalizeObservation({ id: 'fixture://observation/KCOS', geometry: station.geometry, properties: { timestamp: new Date(now - 20 * 60000).toISOString(), temperature: { value: -2, unitCode: 'wmoUnit:degC', qualityControl: 'V' }, dewpoint: { value: -5, unitCode: 'wmoUnit:degC' }, windSpeed: { value: 18, unitCode: 'wmoUnit:km_h-1' }, windDirection: { value: 45, unitCode: 'wmoUnit:degree_(angle)' }, textDescription: 'Synthetic test observation' } }, station, { retrievedAt: start, stale: false }, 'fixture://observation/KCOS');
  return {
    fixture: true, stale: false, point: { latitude, longitude, elevationM: null, gridElevationM: 2500, description: 'Synthetic Colorado fixture', timeZone: 'America/Denver' },
    retrievedAt: start, forecastUpdated: start, gridUpdated: start, forecastValidTimes: `${start}/PT24H`, gridValidTimes: `${start}/PT24H`,
    periods, hourly: periods, observations: [observation], alerts: [{ type: 'Feature', id: 'fixture-alert', geometry: { type: 'Polygon', coordinates: [[[-105.5,38.5],[-104.8,38.5],[-104.8,39.2],[-105.5,39.2],[-105.5,38.5]]] }, properties: { event: 'Fixture Winter Weather Advisory', headline: 'SYNTHETIC TEST ALERT — not an official warning', status: 'Actual', messageType: 'Alert', severity: 'Moderate', sent: start, expires: end, description: 'Synthetic alert for UI testing only.', instruction: 'Do not use fixture data for weather decisions.' }, event: 'Fixture Winter Weather Advisory', headline: 'SYNTHETIC TEST ALERT — not an official warning', severity: 'Moderate', sent: start, expires: end, description: 'Synthetic alert for UI testing only.', instruction: 'Do not use fixture data for weather decisions.' }],
    grids, errors: [], sources: [{ name: 'fixture', sourceUrl: 'fixture://point-weather', retrievedAt: start, stale: false }], forecastSource: 'Synthetic deterministic test fixture', modelInitialization: null, limitations: ['Fixture data is synthetic and must never be presented as live.'], alertStatus: { expired: 0, unknownExpiry: 0 },
  };
}
