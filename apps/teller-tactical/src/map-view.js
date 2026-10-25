import * as maplibregl from 'maplibre-gl';

// MapLibre 6 ships its worker separately. A static asset URL lets Vite copy
// it into the packaged renderer, with no CDN or missing runtime dependency.
maplibregl.setWorkerUrl(new URL('../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).href);

const EMPTY = {type: 'FeatureCollection', features: []};
const DEFAULT_VIEW = {center: [-105.05, 38.95], zoom: 7};
const PLACES = [
  ['Colorado Springs', -104.8214, 38.8339], ['Denver', -104.9903, 39.7392],
  ['Pueblo', -104.6091, 38.2544], ['Woodland Park', -105.0569, 38.9939],
  ['Divide', -105.1569, 38.9417], ['Cripple Creek', -105.1783, 38.7467],
  ['Salida', -105.9989, 38.5347], ['Limon', -103.6922, 39.2639],
];

/** Great-circle range guide. It describes distance, not radar coverage. */
export function coverageRing(longitude, latitude, radiusKm = 230, steps = 96) {
  if (![longitude, latitude, radiusKm, steps].every(Number.isFinite) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || radiusKm <= 0 || !Number.isInteger(steps) || steps < 8 || steps > 1024) {
    throw new RangeError('A range guide requires valid coordinates, positive radius, and 8–1024 segments.');
  }
  const rad = Math.PI / 180, distance = radiusKm / 6371.0088;
  const p = latitude * rad, l = longitude * rad;
  const coordinates = [];
  for (let i = 0; i <= steps; i++) {
    const bearing = i / steps * Math.PI * 2;
    const lat = Math.asin(Math.sin(p) * Math.cos(distance) + Math.cos(p) * Math.sin(distance) * Math.cos(bearing));
    const lon = l + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(p), Math.cos(distance) - Math.sin(p) * Math.sin(lat));
    coordinates.push([((lon / rad + 540) % 360) - 180, lat / rad]);
  }
  // Preserve exact closure despite trigonometric rounding at 2π.
  coordinates[coordinates.length - 1] = [...coordinates[0]];
  return {type: 'Feature', properties: {radiusKm, description: 'Distance guide only; beam height, terrain and blockage are not modeled.'}, geometry: {type: 'LineString', coordinates}};
}

export function viewMatches(a, b) {
  return !!a && !!b && Math.abs(a.center[0] - b.center[0]) < 0.000001 && Math.abs(a.center[1] - b.center[1]) < 0.000001 && Math.abs(a.zoom - b.zoom) < 0.000001 && Math.abs((a.bearing || 0) - (b.bearing || 0)) < 0.000001 && Math.abs((a.pitch || 0) - (b.pitch || 0)) < 0.000001;
}

function safeTime(time) {
  const date = new Date(time);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-US', {timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'}).format(date) : 'Observation time unavailable';
}

function label(className, text, title) {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  if (title) element.title = title;
  return element;
}

function pointCoordinates(item) {
  const longitude = item?.longitude ?? item?.geometry?.coordinates?.[0];
  const latitude = item?.latitude ?? item?.geometry?.coordinates?.[1];
  return Number.isFinite(longitude) && Number.isFinite(latitude) && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90 ? [longitude, latitude] : null;
}

/** GPU map renderer. Network access remains exclusively through the local gateway. */
export class WeatherMap {
  constructor({container, onProbe = () => {}, onCamera = () => {}, onStatus = () => {}, apiBase = ''}) {
    this.container = container;
    this.onProbe = onProbe;
    this.onCamera = onCamera;
    this.onStatus = onStatus;
    this.apiBase = apiBase.replace(/\/$/, '');
    this.theme = 'dark';
    this.generation = 0;
    this.serial = 0;
    this.destroyed = false;
    this.displayed = null;
    this.sources = new Set();
    this.overlayMarkers = [];
    this.placeMarkers = [];
    this.overlays = {};
    this._basemapWarned = false;
    try {
      this.map = new maplibregl.Map({
        container,
        center: DEFAULT_VIEW.center,
        zoom: DEFAULT_VIEW.zoom,
        minZoom: 2,
        maxZoom: 15,
        maxPitch: 60,
        attributionControl: {compact: true},
        canvasContextAttributes: {preserveDrawingBuffer: true, antialias: true},
        // v5 and earlier use this key; retaining it is harmless on v6.
        preserveDrawingBuffer: true,
        renderWorldCopies: false,
        style: {
          version: 8,
          sources: {
            states: {type: 'geojson', data: `${this.apiBase}/us-states.geojson`, attribution: 'Natural Earth · public domain'},
            basemap: this._basemapSource(),
            alerts: {type: 'geojson', data: EMPTY},
            range: {type: 'geojson', data: EMPTY},
          },
          layers: [
            {id: 'background', type: 'background', paint: {'background-color': '#101b28'}},
            {id: 'land', type: 'fill', source: 'states', paint: {'fill-color': '#182736'}},
            {id: 'basemap', type: 'raster', source: 'basemap', paint: {'raster-opacity': 0.83, 'raster-fade-duration': 0}},
            {id: 'states', type: 'line', source: 'states', paint: {'line-color': '#748599', 'line-width': 0.8, 'line-opacity': 0.6}},
            {id: 'alert-fill', type: 'fill', source: 'alerts', paint: {'fill-color': ['match', ['get', 'severity'], 'Extreme', '#ee4d64', 'Severe', '#f98a45', 'Moderate', '#f1cf62', '#68b8d7'], 'fill-opacity': 0.09}},
            {id: 'alert-line', type: 'line', source: 'alerts', paint: {'line-color': ['match', ['get', 'severity'], 'Extreme', '#ee4d64', 'Severe', '#f98a45', 'Moderate', '#f1cf62', '#68b8d7'], 'line-width': 1.4, 'line-opacity': 0.85}},
            {id: 'range', type: 'line', source: 'range', paint: {'line-color': '#63cfdb', 'line-width': 1, 'line-opacity': 0.65, 'line-dasharray': [4, 4]}},
          ],
        },
      });
      this.map.addControl(new maplibregl.NavigationControl({showCompass: true, visualizePitch: true}), 'top-right');
      this.map.addControl(new maplibregl.ScaleControl({unit: 'imperial'}), 'bottom-left');
      this.map.on('error', (event) => {
        if (this.destroyed) return;
        if (event.sourceId === 'basemap' && !this._basemapWarned) {
          this._basemapWarned = true;
          this._status({state: 'warning', scope: 'basemap', message: 'Street map unavailable. Offline Natural Earth boundaries and local place labels remain visible.'});
        } else if (event.sourceId === 'states') {
          this._status({state: 'warning', scope: 'basemap', message: 'Offline boundary file unavailable; check the application installation.'});
        }
      });
      this.map.on('click', event => this.onProbe({longitude: event.lngLat.lng, latitude: event.lngLat.lat}));
      this.map.on('moveend', () => { if (!this.destroyed) this.onCamera(this.getView()); });
      this.ready = new Promise((resolve) => {
        this.map.once('load', () => {
          if (this.destroyed) return resolve(false);
          this._addPlaces();
          this.setOverlays(this.overlays);
          resolve(true);
        });
        this.map.once('remove', () => resolve(false));
      });
    } catch (error) {
      this.map = null;
      const message = `GPU map could not start: ${error.message}. Enable hardware graphics acceleration or use a machine with WebGL2 support.`;
      const fallback = label('teller-map-failure', message);
      fallback.setAttribute('role', 'alert');
      container.append(fallback);
      this.ready = Promise.resolve(false);
      queueMicrotask(() => this._status({state: 'error', scope: 'map', message}));
    }
  }

  _status(status) { if (!this.destroyed) this.onStatus(status); }

  _basemapSource() {
    return {type: 'raster', tiles: [`${this.apiBase}/api/basemap/${this.theme}/{z}/{x}/{y}.png`], tileSize: 256, minzoom: 0, maxzoom: 18, attribution: '© OpenStreetMap contributors · © CARTO'};
  }

  _addPlaces() {
    for (const [name, longitude, latitude] of PLACES) {
      const marker = new maplibregl.Marker({element: label('teller-place-label', name), anchor: 'bottom', offset: [0, -2]}).setLngLat([longitude, latitude]).addTo(this.map);
      this.placeMarkers.push(marker);
    }
  }

  getView() {
    if (!this.map) return {...DEFAULT_VIEW, center: [...DEFAULT_VIEW.center]};
    const center = this.map.getCenter();
    return {center: [center.lng, center.lat], zoom: this.map.getZoom(), bearing: this.map.getBearing(), pitch: this.map.getPitch()};
  }

  setView(view) {
    if (!this.map || this.destroyed || !view || !Array.isArray(view.center) || view.center.length !== 2 || !view.center.every(Number.isFinite) || !Number.isFinite(view.zoom)) return;
    if (!viewMatches(this.getView(), view)) this.map.jumpTo({...view, zoom: Math.max(2, Math.min(15, view.zoom))});
  }

  setTheme(theme) {
    if (!['dark', 'light'].includes(theme) || theme === this.theme) return;
    this.theme = theme;
    this.container.dataset.mapTheme = theme;
    void this.ready.then(ready => {
      if (!ready || this.destroyed) return;
      this._basemapWarned = false;
      if (this.map.getLayer('basemap')) this.map.removeLayer('basemap');
      if (this.map.getSource('basemap')) this.map.removeSource('basemap');
      this.map.addSource('basemap', this._basemapSource());
      this.map.addLayer({id: 'basemap', type: 'raster', source: 'basemap', paint: {'raster-opacity': 0.83, 'raster-fade-duration': 0}}, 'states');
      this.map.setPaintProperty('background', 'background-color', theme === 'light' ? '#e7edf0' : '#101b28');
      this.map.setPaintProperty('land', 'fill-color', theme === 'light' ? '#e2e9e9' : '#182736');
      this.map.setPaintProperty('states', 'line-color', theme === 'light' ? '#647a8b' : '#748599');
    });
  }

  _removeWeather(id) {
    if (!this.map || !this.sources.has(id)) return;
    if (this.map.getLayer(id)) this.map.removeLayer(id);
    if (this.map.getSource(id)) this.map.removeSource(id);
    this.sources.delete(id);
  }

  async setProduct(product, frameId, opacity = 0.8) {
    const generation = ++this.generation;
    this.cancelPending?.();
    this.cancelPending = null;
    if (!await this.ready || this.destroyed || generation !== this.generation) return false;
    const alpha = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 0.8;
    const frame = product?.frames?.find(candidate => candidate.id === frameId);
    if (!product || !frame) {
      for (const id of [...this.sources]) this._removeWeather(id);
      this.displayed = null;
      this._status({state: 'empty', scope: 'weather', frameId: null, time: null, message: product ? 'No verified frame is selected.' : 'No weather layer selected.'});
      return false;
    }
    if (this.displayed?.product.id === product.id && this.displayed?.frame.id === frameId) {
      this.map.setPaintProperty(this.displayed.layer, 'raster-opacity', alpha);
      this._status({state: 'ready', scope: 'weather', frameId, time: frame.time, missingTiles: this.displayed.missingTiles, message: this.displayed.missingTiles ? 'Some visible tiles are missing.' : ''});
      return true;
    }
    for (const id of [...this.sources]) if (id !== this.displayed?.layer) this._removeWeather(id);
    const sourceId = `weather-${++this.serial}`;
    this.sources.add(sourceId);
    this._status({state: 'loading', scope: 'weather', frameId: this.displayed?.frame.id ?? null, time: this.displayed?.frame.time ?? null, requestedFrameId: frameId, requestedTime: frame.time, message: 'Loading visible frame tiles…'});
    let successfulTiles = 0, missingTiles = 0, done = false, timeout;
    const result = await new Promise(resolve => {
      const finish = ok => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        this.map.off('sourcedata', onData);
        this.map.off('error', onError);
        this.map.off('idle', onIdle);
        this.map.off('remove', onRemove);
        if (this.cancelPending === cancel) this.cancelPending = null;
        resolve(ok);
      };
      const cancel = () => finish(false);
      const onError = event => { if (event.sourceId === sourceId) { missingTiles++; if (successfulTiles === 0 && this.map.isSourceLoaded(sourceId)) finish(false); } };
      const onData = event => {
        if (event.sourceId !== sourceId) return;
        // Raster source metadata also emits a tile-less 'content' event.
        // It proves neither a successful image response nor accepted GPU data.
        if (event.tile?.state === 'loaded' && (event.tile.texture || event.tile.rasterTexture)) successfulTiles++;
        if (successfulTiles > 0 && this.map.isSourceLoaded(sourceId)) finish(true);
      };
      const onIdle = () => { if (successfulTiles > 0 && this.map.isSourceLoaded(sourceId)) finish(true); else if (missingTiles > 0) finish(false); };
      const onRemove = () => finish(false);
      this.cancelPending = cancel;
      this.map.on('sourcedata', onData);
      this.map.on('error', onError);
      this.map.on('idle', onIdle);
      this.map.on('remove', onRemove);
      timeout = setTimeout(() => finish(successfulTiles > 0), 8000);
      try {
        this.map.addSource(sourceId, {type: 'raster', tiles: [`${this.apiBase}/api/tiles/${encodeURIComponent(product.id)}/${encodeURIComponent(frameId)}/{z}/{x}/{y}.png`], tileSize: 256, minzoom: Number.isInteger(product.minZoom) ? Math.max(0, product.minZoom) : 0, maxzoom: Number.isInteger(product.maxZoom) ? Math.min(14, product.maxZoom) : 14, attribution: product.source || ''});
        this.map.addLayer({id: sourceId, type: 'raster', source: sourceId, paint: {'raster-opacity': 0, 'raster-fade-duration': 0, 'raster-resampling': 'linear'}}, 'alert-fill');
      } catch {
        finish(false);
      }
    });
    if (this.destroyed || generation !== this.generation) {
      if (!this.destroyed) this._removeWeather(sourceId);
      return false;
    }
    if (!result) {
      this._removeWeather(sourceId);
      this._status({state: 'error', scope: 'weather', frameId: this.displayed?.frame.id ?? null, time: this.displayed?.frame.time ?? null, requestedFrameId: frameId, requestedTime: frame.time, missingTiles, message: 'Frame tiles did not load. The last displayed frame is retained; check source access and diagnostics.'});
      return false;
    }
    this.map.setPaintProperty(sourceId, 'raster-opacity', alpha);
    const previous = this.displayed?.layer;
    this.displayed = {product, frame, layer: sourceId, missingTiles};
    if (previous) this._removeWeather(previous);
    this._status({state: 'ready', scope: 'weather', frameId, time: frame.time, requestedFrameId: frameId, requestedTime: frame.time, missingTiles, message: missingTiles ? `${missingTiles} tile request(s) failed; this frame is partial.` : ''});
    return true;
  }

  setOverlays(overlays = {}) {
    this.overlays = overlays;
    if (!this.map || !this.map.getSource('alerts') || this.destroyed) return;
    for (const marker of this.overlayMarkers) marker.remove();
    this.overlayMarkers = [];
    const referenceNow = Number.isFinite(overlays.now) ? overlays.now : Date.now();
    const rawAlerts = Array.isArray(overlays.alerts) ? overlays.alerts : overlays.alerts?.features || [];
    const alerts = rawAlerts.filter(feature => feature?.type === 'Feature' && ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)).filter(feature => {
      const expiration = Date.parse(feature.properties?.expires ?? feature.expires);
      return Number.isFinite(expiration) && expiration > referenceNow;
    }).map(feature => ({...feature, properties: {...feature.properties, severity: feature.properties?.severity ?? feature.severity}}));
    this.map.getSource('alerts')?.setData({type: 'FeatureCollection', features: alerts});
    const siteCoordinates = pointCoordinates(overlays.site);
    let range = EMPTY;
    if (siteCoordinates) {
      const radius = Number.isFinite(overlays.site.rangeKm) ? overlays.site.rangeKm : 230;
      range = {type: 'FeatureCollection', features: [coverageRing(...siteCoordinates, radius)]};
      this._marker(siteCoordinates, 'teller-site-marker', overlays.site.id || 'Radar site', `${overlays.site.name || 'Radar site'} · ${radius} km distance guide, not guaranteed coverage. Terrain blockage and beam height are not modeled.`);
    }
    this.map.getSource('range')?.setData(range);
    for (const observation of (overlays.observations || []).slice(0, 50)) {
      const coordinates = pointCoordinates(observation);
      if (!coordinates) continue;
      const temperatureF = Number.isFinite(observation.temperatureF) ? observation.temperatureF : Number.isFinite(observation.temperatureC) ? observation.temperatureC * 1.8 + 32 : null;
      const text = `${observation.stationId || observation.name || 'Station'} ${temperatureF === null ? '—' : `${Math.round(temperatureF)}°`}`;
      const timestamp = observation.timestamp || observation.observedAt;
      const age = referenceNow - Date.parse(timestamp);
      const stale = observation.stale || !Number.isFinite(age) || age > 90 * 60 * 1000;
      this._marker(coordinates, `teller-observation-marker${stale ? ' is-stale' : ''}`, text, `${observation.name || observation.stationId || 'Station'} · ${temperatureF === null ? 'Temperature unavailable' : `${temperatureF.toFixed(1)} °F`} · ${safeTime(timestamp)}${stale ? ' · old or unavailable observation time' : ''}`);
    }
    const property = pointCoordinates(overlays.property);
    const point = pointCoordinates(overlays.point);
    if (point && (!property || Math.abs(point[0] - property[0]) > 0.000001 || Math.abs(point[1] - property[1]) > 0.000001)) this._marker(point, 'teller-point-marker', '＋', `${overlays.point.label || 'Selected forecast point'} · ${point[1].toFixed(5)}, ${point[0].toFixed(5)} · forecast location, not an assumed property location`);
    if (property) this._marker(property, 'teller-property-marker', '⌂', `Your property · ${property[1].toFixed(5)}, ${property[0].toFixed(5)}${Number.isFinite(overlays.property.elevationFt) ? ` · ${overlays.property.elevationFt.toLocaleString()} ft (user supplied)` : ''}`);
  }

  _marker(coordinates, className, text, title) {
    const marker = new maplibregl.Marker({element: label(className, text, title), anchor: 'bottom', offset: [0, -3]}).setLngLat(coordinates).addTo(this.map);
    this.overlayMarkers.push(marker);
  }

  resize() { this.map?.resize(); }

  exportImage() {
    if (!this.map || this.destroyed) throw new Error('Map is unavailable.');
    const source = this.map.getCanvas();
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image export is unavailable.');
    context.drawImage(source, 0, 0);
    const scale = window.devicePixelRatio || 1;
    const pad = 14 * scale, line = 18 * scale;
    const lines = [
      'TELLER TACTICAL',
      this.displayed ? `${this.displayed.product.name} · ${safeTime(this.displayed.frame.time)}` : 'No weather frame displayed',
      this.displayed ? `${this.displayed.product.source}${this.displayed.missingTiles ? ' · PARTIAL FRAME' : ''}` : 'Weather data unavailable',
      'Map: © OpenStreetMap · © CARTO · Natural Earth · EPSG:3857',
    ];
    context.fillStyle = 'rgba(9,18,29,0.90)';
    context.fillRect(0, canvas.height - pad * 2 - line * lines.length, canvas.width, pad * 2 + line * lines.length);
    context.font = `${12 * scale}px system-ui, sans-serif`;
    context.fillStyle = '#eef4fa';
    lines.forEach((text, index) => context.fillText(text, pad, canvas.height - pad - (lines.length - index - 1) * line));
    return canvas.toDataURL('image/png');
  }

  destroy() {
    if (this.destroyed) return;
    this.cancelPending?.();
    this.destroyed = true;
    this.generation++;
    for (const marker of [...this.overlayMarkers, ...this.placeMarkers]) marker.remove();
    this.map?.remove();
    this.map = null;
  }
}
