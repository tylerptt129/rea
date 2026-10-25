/** Pure numerical/display helpers. All source values remain available unchanged. */
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
export const celsiusToFahrenheit = (value) => finite(value) ? value * 9 / 5 + 32 : null;
export const fahrenheitToCelsius = (value) => finite(value) ? (value - 32) * 5 / 9 : null;
export const metersToFeet = (value) => finite(value) ? value / 0.3048 : null;
export const feetToMeters = (value) => finite(value) ? value * 0.3048 : null;
export const mmToInches = (value) => finite(value) ? value / 25.4 : null;
export const metersPerSecondToMph = (value) => finite(value) ? value / 0.44704 : null;
export const kilometersPerHourToMph = (value) => finite(value) ? value / 1.609344 : null;
export const degreesToCardinal = (value) => finite(value)
  ? ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(((value % 360 + 360) % 360) / 22.5) % 16]
  : '—';

/** Validate a geographic point; missing coordinates must never become (0, 0). */
export function validatePoint(latitude, longitude) {
  if (!finite(latitude) || !finite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
    throw new RangeError('Latitude must be a finite number from -90 to 90 and longitude from -180 to 180.');
  return { latitude, longitude };
}

export const WEB_MERCATOR_LIMIT = 20037508.342789244;
export const WEB_MERCATOR_MAX_LATITUDE = 85.0511287798066;
export function lonLatToMercator(longitude, latitude) {
  validatePoint(latitude, longitude);
  if (Math.abs(latitude) > WEB_MERCATOR_MAX_LATITUDE)
    throw new RangeError('Latitude is outside Web Mercator coverage.');
  return [longitude * WEB_MERCATOR_LIMIT / 180, Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)) * WEB_MERCATOR_LIMIT / Math.PI];
}
export function mercatorToLonLat(x, y) {
  if (!finite(x) || !finite(y) || Math.abs(x) > WEB_MERCATOR_LIMIT || Math.abs(y) > WEB_MERCATOR_LIMIT)
    throw new RangeError('Coordinates are outside the Web Mercator world extent.');
  return [x * 180 / WEB_MERCATOR_LIMIT, Math.atan(Math.sinh(y * Math.PI / WEB_MERCATOR_LIMIT)) * 180 / Math.PI];
}
/** XYZ tile to EPSG:3857 WMS bounding box [west,south,east,north], in metres. */
export function tileBBox(z, x, y) {
  if (!Number.isInteger(z) || z < 0 || z > 22 || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z)
    throw new RangeError('Invalid XYZ tile coordinate.');
  const span = 2 * WEB_MERCATOR_LIMIT / 2 ** z;
  const west = -WEB_MERCATOR_LIMIT + x * span;
  const north = WEB_MERCATOR_LIMIT - y * span;
  return [west, north - span, west + span, north];
}

const timestamp = (value) => {
  if (typeof value === 'number') return finite(value) ? value : NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return NaN;
  return Date.parse(value);
};
export function formatTime(value, { date = false, seconds = false, timeZone = 'America/Denver' } = {}) {
  const time = timestamp(value);
  if (!Number.isFinite(time)) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone, ...(date ? { month: 'short', day: 'numeric' } : {}),
    hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}),
    timeZoneName: 'short',
  }).format(new Date(time));
}
export function ageMinutes(value, now = Date.now()) {
  const time = timestamp(value);
  const current = timestamp(now);
  return Number.isFinite(time) && Number.isFinite(current) ? (current - time) / 60000 : null;
}

/** ISO 8601 fixed durations. Calendar years/months have no fixed millisecond size. */
export function parseDuration(value) {
  if (typeof value !== 'string') return null;
  const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (!match || !match.slice(1).some((part) => part !== undefined)) return null;
  const duration = ((Number(match[1] ?? 0) * 24 + Number(match[2] ?? 0)) * 60 + Number(match[3] ?? 0)) * 60000 + Number(match[4] ?? 0) * 1000;
  return duration > 0 && Number.isFinite(duration) ? duration : null;
}
export function parseValidTime(value) {
  if (typeof value !== 'string') return null;
  const pieces = value.split('/');
  if (pieces.length !== 2) return null;
  let start = timestamp(pieces[0]);
  let end = timestamp(pieces[1]);
  if (pieces[1].startsWith('P')) {
    const duration = parseDuration(pieces[1]);
    if (duration !== null) end = start + duration;
  } else if (pieces[0].startsWith('P')) {
    const duration = parseDuration(pieces[0]);
    if (duration !== null) start = end - duration;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end, startIso: new Date(start).toISOString(), endIso: new Date(end).toISOString(), durationMs: end - start };
}

/**
 * Sum NWS interval accumulations only when the entire requested window is covered
 * by complete, non-overlapping intervals. Never prorate a partly intersecting
 * interval: the within-interval precipitation distribution is unknown.
 */
export function accumulateGrid(grid, windowStart, windowEnd) {
  const start = timestamp(windowStart);
  const end = timestamp(windowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new RangeError('Accumulation window needs explicit start/end timestamps with timezone offsets.');
  const result = {
    value: null, total: null, knownTotal: null, complete: false,
    uom: typeof grid?.uom === 'string' ? grid.uom : null,
    start: new Date(start).toISOString(), end: new Date(end).toISOString(),
    intervalCount: 0, excludedPartialIntervals: 0, missingIntervals: 0,
    coveredMs: 0, coverageFraction: 0, errors: [],
  };
  if (!grid || !Array.isArray(grid.values)) {
    result.errors.push('This product is unavailable for the selected point.');
    return result;
  }
  const intervals = [];
  for (const entry of grid.values) {
    const period = parseValidTime(entry?.validTime);
    if (!period) { result.errors.push('Source contains an invalid validTime interval.'); continue; }
    if (period.end <= start || period.start >= end) continue;
    if (period.start < start || period.end > end) { result.excludedPartialIntervals += 1; continue; }
    intervals.push({ ...period, value: entry.value });
  }
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  let cursor = start;
  let sum = 0;
  let overlaps = false;
  let gap = false;
  for (const interval of intervals) {
    if (interval.start < cursor) { overlaps = true; continue; }
    if (interval.start > cursor) gap = true;
    cursor = interval.end;
    if (!finite(interval.value) || interval.value < 0) { result.missingIntervals += 1; continue; }
    result.intervalCount += 1;
    result.coveredMs += interval.durationMs;
    sum += interval.value;
  }
  result.coverageFraction = Math.min(1, result.coveredMs / (end - start));
  result.knownTotal = overlaps ? null : result.intervalCount > 0 ? sum : null;
  if (overlaps) result.errors.push('Overlapping accumulation intervals cannot be safely added.');
  if (gap || cursor < end) result.errors.push('The selected window is not fully covered by source intervals.');
  if (result.excludedPartialIntervals) result.errors.push('Partial source intervals are excluded; no within-interval distribution was assumed.');
  if (result.missingIntervals) result.errors.push('At least one source interval has missing or invalid precipitation.');
  result.complete = !overlaps && !gap && cursor === end && result.coveredMs === end - start && result.missingIntervals === 0 && result.errors.length === 0;
  if (result.complete) result.value = result.total = sum;
  return result;
}

export function gridValueAt(grid, time = Date.now()) {
  const when = timestamp(time);
  if (!Number.isFinite(when) || !Array.isArray(grid?.values)) return null;
  const entry = grid.values.find((item) => {
    const interval = parseValidTime(item?.validTime);
    return interval && interval.start <= when && when < interval.end;
  });
  return entry ? { value: entry.value, uom: grid.uom ?? null, validTime: entry.validTime } : null;
}

/** Official alert expiry is mandatory; malformed expiry stays unknown, not active. */
export function isAlertActive(alert, now = Date.now()) {
  const properties = alert?.properties ?? alert;
  const expiry = timestamp(properties?.expires);
  const current = timestamp(now);
  return Number.isFinite(expiry) && Number.isFinite(current) && expiry > current && (properties?.status === undefined || properties.status === 'Actual') && properties?.messageType !== 'Cancel';
}

/**
 * Explain available source inputs without inventing terrain thresholds, snow
 * ratios, or confidence. This is descriptive guidance, not an upslope forecast.
 */
export function stormIngredients(weather, { elevationFt = null, now = Date.now() } = {}) {
  const grids = weather?.grids ?? {};
  const current = Object.fromEntries(['temperature','dewpoint','relativeHumidity','windSpeed','windDirection','snowLevel','weather'].map((name) => [name, gridValueAt(grids[name], now)]));
  const ingredients = [];
  const unavailable = [];
  const add = (id, label, note) => {
    const field = current[id];
    if (!field || field.value === null || field.value === undefined) { unavailable.push(label); return; }
    ingredients.push({ id, label, value: field.value, uom: field.uom, validTime: field.validTime, note });
  };
  add('temperature', 'Forecast temperature', 'Grid temperature is not corrected to property elevation.');
  add('dewpoint', 'Forecast dew point', 'Temperature and dew point describe near-surface moisture; no fixed precipitation threshold is assumed.');
  add('relativeHumidity', 'Forecast relative humidity', 'Humidity alone does not determine whether precipitation will occur.');
  add('windSpeed', 'Forecast wind speed', 'Grid winds do not resolve every mountain ridge, valley, or shelter effect.');
  add('windDirection', 'Forecast wind direction', 'Direction is where wind comes from. Terrain-normal flow requires a terrain profile and vertical winds, which are unavailable.');
  add('snowLevel', 'Forecast snow level', 'Source snow level is guidance rather than a property precipitation-type guarantee.');
  add('weather', 'Official forecast weather', 'Source weather categories are retained; no independent precipitation-type algorithm is applied.');
  const gridElevationM = weather?.point?.gridElevationM;
  const propertyElevationM = feetToMeters(elevationFt);
  return {
    method: 'Descriptive NWS forecast inputs only; no upslope threshold, snow ratio, or confidence score is calculated.',
    ingredients, unavailable,
    elevationDifferenceM: finite(gridElevationM) && propertyElevationM !== null ? propertyElevationM - gridElevationM : null,
    limitations: [
      'NWS gridded forecasts represent an approximately 2.5 km grid square; complex terrain and property microclimates remain unresolved.',
      'No vertical temperature profile, terrain-normal moisture flux, or independent model ensemble is available from these fields.',
      'Official forecast issue time is not a numerical model initialization time.',
    ],
  };
}
