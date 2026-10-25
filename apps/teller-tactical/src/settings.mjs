/** Persisted preferences are an input boundary, not trusted renderer state. */
const finite = value => typeof value === 'number' && Number.isFinite(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'dark', layout: 1, linkCamera: true, linkTime: true,
  opacity: 0.82, speed: 500, showAlerts: true, showObservations: true,
  property: null, views: Object.freeze([]),
  camera: Object.freeze({ center: Object.freeze([-105.08, 38.98]), zoom: 7.4 }),
  layersOpen: true, weatherOpen: true,
});

/** Saved map cameras stay within the actual renderer's supported extent. */
export function normalizeCamera(value, fallback = DEFAULT_SETTINGS.camera) {
  const camera = record(value);
  const center = camera.center;
  if (!Array.isArray(center) || center.length !== 2 || !center.every(finite) || Math.abs(center[0]) > 180 || Math.abs(center[1]) > 85.0511287798066 || !finite(camera.zoom))
    return { center: [...fallback.center], zoom: fallback.zoom, ...(finite(fallback.bearing) ? { bearing: fallback.bearing } : {}), ...(finite(fallback.pitch) ? { pitch: fallback.pitch } : {}) };
  return {
    center: [...center], zoom: clamp(camera.zoom, 2, 15),
    bearing: finite(camera.bearing) ? ((camera.bearing + 180) % 360 + 360) % 360 - 180 : 0,
    pitch: finite(camera.pitch) ? clamp(camera.pitch, 0, 60) : 0,
  };
}

export function normalizeProperty(value) {
  const property = record(value);
  if (!finite(property.latitude) || !finite(property.longitude) || property.latitude < -90 || property.latitude > 90 || property.longitude < -180 || property.longitude > 180 || !finite(property.elevationFt) || property.elevationFt < -1500 || property.elevationFt > 30000)
    return null;
  return { latitude: property.latitude, longitude: property.longitude, elevationFt: property.elevationFt };
}

export function normalizeSettings(value) {
  const saved = record(value);
  const settings = {
    theme: ['dark', 'light'].includes(saved.theme) ? saved.theme : DEFAULT_SETTINGS.theme,
    layout: [1, 2, 4].includes(saved.layout) ? saved.layout : DEFAULT_SETTINGS.layout,
    opacity: finite(saved.opacity) ? clamp(saved.opacity, 0, 1) : DEFAULT_SETTINGS.opacity,
    speed: [250, 500, 1000].includes(saved.speed) ? saved.speed : DEFAULT_SETTINGS.speed,
    property: normalizeProperty(saved.property),
    camera: normalizeCamera(saved.camera),
    views: [],
  };
  for (const name of ['linkCamera', 'linkTime', 'showAlerts', 'showObservations', 'layersOpen', 'weatherOpen'])
    settings[name] = typeof saved[name] === 'boolean' ? saved[name] : DEFAULT_SETTINGS[name];
  if (Array.isArray(saved.views)) {
    for (const entry of saved.views.slice(-20)) {
      const view = record(entry);
      if (typeof view.name !== 'string' || !view.name.trim()) continue;
      const camera = record(view.camera);
      if (!Array.isArray(camera.center) || camera.center.length !== 2 || !camera.center.every(finite) || Math.abs(camera.center[0]) > 180 || Math.abs(camera.center[1]) > 85.0511287798066 || !finite(camera.zoom)) continue;
      settings.views.push({ name: view.name.trim().slice(0, 60), camera: normalizeCamera(camera) });
    }
  }
  return settings;
}

/** 1e-7 degrees (~1 cm latitude) absorbs serialization rounding, not nearby sites. */
export function isPropertyPoint(property, point) {
  return !!property && !!point && finite(property.latitude) && finite(property.longitude) && finite(point.latitude) && finite(point.longitude)
    && Math.abs(property.latitude - point.latitude) <= 1e-7 && Math.abs(property.longitude - point.longitude) <= 1e-7;
}

export function propertyElevationForPoint(settings, point) {
  const property = normalizeProperty(settings?.property);
  return isPropertyPoint(property, point) ? property.elevationFt : null;
}

/** Own save ordering across debouncing, in-flight requests, and native shutdown. */
export function createPreferenceWriter({ read, write, onError = () => {}, delay = 250 }) {
  let timer;
  let chain = Promise.resolve();
  const enqueue = () => {
    clearTimeout(timer);
    timer = undefined;
    // Capture this generation now; an older in-flight write must complete first.
    const snapshot = structuredClone(read());
    const operation = chain.then(() => write(snapshot));
    // Keep subsequent generations usable after one failed request.
    chain = operation.catch(error => { onError(error); });
    return operation;
  };
  return {
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => { void enqueue().catch(() => {}); }, delay);
    },
    flush() { return enqueue(); },
    settled() { return chain; },
  };
}
