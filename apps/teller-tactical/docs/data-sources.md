# Weather data source register

This register separates source documentation from operations verified in this cloud task. Checked 2026-10-25 UTC. No WSV3 backend, commercial weather feed, extracted credential, or reference binary is used.

## Current access evidence

The original environment policy allowed package-manager/GitHub destinations only. Read-only requests through the inherited HTTPS proxy to `api.weather.gov`, `mesonet.agron.iastate.edu`, `nowcoast.noaa.gov`, and `cdn.star.nesdis.noaa.gov` were denied with `Tunnel connection failed: 403 Forbidden`. A separate sandbox restriction initially prevented sockets; the same requests with sandbox escalation reached the proxy and established the destination denial. TLS verification stayed enabled. No direct-route or proxy bypass was attempted.

The parent agent saved additive domain requirements in the environment draft. Saving a draft does not establish runtime access. Live service capabilities, imagery, freshness, cadence, and representative response schemas remain **not live-verified** until affected requests succeed after settings are applied. Do not label sample data or a locally rendered fixture as a successful live feed.

Authoritative upstream documentation is available from permitted GitHub hosts and retained in `data-evidence/`; its manifest records source URLs, commits where applicable, retrieval times, and SHA-256 hashes. These sources support adapter construction but do not prove the current endpoint is serving data.

## NWS API: alerts, forecasts, and surface observations

- Provider: US National Weather Service. Production host: `https://api.weather.gov`.
- Authoritative schema: [weather-gov/api OpenAPI at inspected commit](https://github.com/weather-gov/api/blob/694ed0f5526336e58d513a8b8a2b313d7896bbf7/assets/openapi.yaml). Retrieved schema advertises OpenAPI 3.0.3, service schema version 1.9.0. The repository README identifies it as the NWS API team/community documentation source. Minimal factual metadata and exact upstream blob/content hashes are retained in [`data-evidence/nws-schema-facts.json`](data-evidence/nws-schema-facts.json). No license file was present in the inspected 18-path repository tree, so full schema/README copies were removed; no blanket redistribution license or public-domain status is inferred.
- Authentication: schema requires an identifying `User-Agent`; it does not define a paid API key for these products. Use a clear application identifier and real project/contact URL. Do not invent a contact email.
- Discovery: `/points/{latitude},{longitude}` supplies `forecast`, `forecastHourly`, `forecastGridData`, and `observationStations`. Follow returned HTTPS URLs only after validating their provider host. Grid office and indices can change; do not hardcode them for the user's property.
- Alerts: `/alerts/active?point=latitude,longitude` returns official alert features and source text. Preserve `id`, `sent`, `effective`, `onset`, `expires`, `ends`, severity, certainty, urgency, and geometry (which can be null). Expire an alert according to its actual timestamps rather than leaving a stale red polygon visible indefinitely. An empty list means no active alerts returned at retrieval; a failed request means unknown.
- Observations: discover stations, then `/stations/{stationId}/observations/latest`. Preserve the observation `timestamp`, station location/elevation, raw `QuantitativeValue` fields, `unitCode`, and `qualityControl`. Null measurements are missing, never zero. A nearby station may be in a very different elevation/exposure regime.
- Forecasts: detailed and hourly public forecasts carry update/generation timestamps and period start/end times. They are official forecast products; their generation time is **not** a numerical-model initialization time. Do not call them HRRR, GFS, or an ensemble unless a separate adapter establishes that provenance.
- Grid forecast: preserve `updateTime`, grid geometry/elevation, `uom`, and each `{validTime,value}` entry. Schema lists `quantitativePrecipitation`, `snowfallAmount`, `snowLevel`, `iceAccumulation`, relative humidity, and other fields, but presence in the schema does not guarantee a particular local forecast provides them. `validTime` is an ISO-8601 interval. Amounts over a window must use the documented interval meaning; do not sum overlapping intervals or silently prorate an amount without a method label.
- Terms/limits: official service documentation is linked by the OpenAPI at `https://www.weather.gov/documentation/services-web-api`. That site is pending runtime access. The API's numerical rate limit and current service policy were not verified in this task. Honor HTTP cache headers, `Retry-After`, conditional requests, deduplication, and bounded exponential backoff. Never claim a service-level guarantee.

## IEM NEXRAD reflectivity mosaic

- Provider: Iowa Environmental Mesonet, Iowa State University; derived from NWS Level III products. This is a **provider mosaic**, neither raw single-site radar nor a Teller Tactical composite.
- Authority: [akrherz/iem](https://github.com/akrherz/iem), inspected commit `3039e621fde72c23185584b8a84f15ba59ddb3c8`. Documentation source `htdocs/docs/nexrad_mosaic/index.phtml`; service definitions `data/wms/nexrad/n0q.map`, `n0q-t.map`; metadata source `pylib/iemweb/json/radar.py`, `tms.py`.
- Metadata/latest: `https://mesonet.agron.iastate.edu/json/tms.json`. Documented source emits `services[]` with `id: ridge_uscomp_n0q`, a `layername` such as `ridge::USCOMP-N0Q-YYYYMMDDHHMM`, and `utc_valid` read from actual `n0q_0.json.meta.valid`. Root generation metadata was renamed to `generated_at` in March 2026; it is distinct from the valid time. Source caches this metadata 15 seconds.
- Available frames: `/json/radar?operation=list&radar=USCOMP&product=N0Q&start=<UTC ISO>&end=<UTC ISO>` emits `scans: [{ts:"YYYY-MM-DDTHH:MMZ"}]` only for files present in its archive. The source limits a request to ten days and thins results above 500 scans. Use a short bounded range for animation. A listed frame can still fail image retrieval; track that separately.
- Time-aware raster: `https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi`, layer `nexrad-n0q-wmst`, WMS with `SRS=EPSG:3857`, explicit UTC `TIME`, transparent PNG, and bounded 256/512-pixel map requests. Use WMS 1.1.1 `SRS` consistently to avoid the axis-order difference of WMS 1.3.0 `CRS=EPSG:4326`.
- Current relative layers: `n0q.cgi` defines group `nexrad-n0q-900913` and five-minute relative groups `...-m05m` through `...-m55m`; absolute-time requests are preferable for a stable loop. Capabilities contain a **static** time extent `2011-02-16/2026-12-31/PT5M` and an old 2011 default. Neither is a real-time latest observation or availability manifest.
- Meaning: the map source describes an IEM-generated mosaic of NWS WSR-88D Level III base reflectivity. The documentation says images are produced every five minutes and can combine individual inputs within 15 minutes of processing. A mosaic's nominal time is not every contributing radar's sweep time.
- Resolution/units: documentation describes N0Q's 0.5 dBZ value quantization, CONUS PNG dimensions 12200×5400 after August 2014, and EPSG:4326 image/world-file delivery. Quantization is not spatial resolution. Tile resampling changes display pixels; never report a reprojected color pixel as an exact radar gate measurement.
- Missing values and terrain: the IEM documentation explicitly says its display product does not distinguish missing data/beam blockage from black/no echo. Transparency must not be interpreted as verified clear weather, particularly in Colorado mountains. Display the limitation next to radar coverage/probing.
- Numeric probing: a WMS PNG is a rendered display product. Exact numerical probing requires the original index/value and nodata contract or a verified server query. Do not reverse-map blended RGB colors and label the result exact. Until such an adapter exists, provide geographic/time probing and label the numeric value unavailable.
- Terms: service source metadata says `wms_accessconstraints: None` and identifies Iowa State University. No authentication appears in these source contracts. This does not establish a production SLA or unlimited tile-download entitlement. Attribute IEM/NWS, honor caching (current raster map sets max-age 300 seconds), and avoid bulk scrapes.

## Single-site radar and radial velocity

The same documented IEM metadata service supports `radar=PUX` (Pueblo), other discovered radar IDs, and products including `N0B`, `N0Q`, `N0U`, `N0S`, and `N0V` where archived. `operation=products` discovers what a site actually has; `operation=available` can discover radar location/network metadata. `/json/ridge_current.py?product=N0B` returns most-recent metadata from actual site files.

This is source-level evidence only. A site/product should enter the usable interface only after its georeferencing, timestamp, legend, coverage, and value contract have been tested. Do not relabel the national N0Q mosaic as a selected site's reflectivity or expose a velocity button backed by that mosaic. Raw Level II, dual-pol numerical data, beam heights, and terrain occultation remain separate work.

## GOES satellite candidates

IEM current source contains:

| Service | Layer | Source registration | Source-defined support |
| --- | --- | --- | --- |
| `/cgi-bin/wms/goes/conus_vis.cgi` | `conus_vis_1km` | GOES-19 ABI C02, visible | EPSG:4326/3857, current raster |
| `/cgi-bin/wms/goes/conus_ir.cgi` | `conus_ir_4km` | GOES-19 ABI C13, infrared | EPSG:4326/3857, current raster |
| `/cgi-bin/wms/goes/conus_wv.cgi` | `conus_wv_4km` | GOES-19 ABI C09, water vapor | EPSG:4326/3857, current raster |

The layer names have legacy resolution suffixes; a suffix is not sufficient evidence for actual delivered spatial resolution. These definitions contain no time dimension or observation timestamp. Do not construct an animation by assigning current wall-clock times to repeated latest images. Do not call C09 "upper-level water vapor" without channel-specific documentation. The generic legacy `goes/goes.cgi` definition uses GINI/AWIPS paths and is not sufficient evidence for modern GOES availability.

The IEM GIS documentation explains that imagery is processed from Unidata NIMAGE and stored with geostationary projection metadata; it also records discontinued Hawaii services. Current ABI satellite identity and coverage must be read from actual metadata, rather than frozen GOES-16/GOES-18 names.

NASA GIBS is independently documented by [nasa-gibs/worldview](https://github.com/nasa-gibs/worldview), inspected commit `176a21fe9b01335ae9d4a6c8117515e3dbd1bd63`. Its current source defines `GOES-East_ABI_Band13_Clean_Infrared` (C13, 10.3 µm, 2 km sensor and delivered imagery) and `GOES-East_ABI_Band2_Red_Visible_1km` (C02, 0.64 µm, 0.5 km sensor/1 km delivered). NASA's layer documentation states 10-minute temporal resolution, approximately **40-minute latency**, and rolling 90-day availability. This latency must be visible; this feed must not be advertised as low-latency tactical imagery. Visible imagery is primarily useful in daylight. No standalone water-vapor layer ID was found in the inspected Worldview GOES registration.

The inspected NASA source registers `https://gibs-{a-c}.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi` and `/wms/epsg4326/best/wms.cgi`, with polar counterparts. It does not establish a Web Mercator endpoint or tile-matrix ID. Live capabilities must establish available scan timestamps, supported projection, matrices, units, and response behavior; do not guess a `GoogleMapsCompatible_*` matrix. GIBS capabilities that merely enumerate a calendar/nominal interval do not by themselves prove every scan exists.

NOAA nowCOAST remains another candidate pending live metadata verification. NOAA STAR `latest.jpg` is useful for human imagery context but is insufficient by itself for a georeferenced, timestamp-precise animation.

Evidence copies of IEM source are retained with the unmodified upstream permissive license text (MIT form), copyright 2005 Iowa State University, in [`data-evidence/iem-LICENSE.txt`](data-evidence/iem-LICENSE.txt). NASA Worldview metadata/documentation copies are retained with its NASA Open Source Agreement v1.3 notice in [`data-evidence/nasa-worldview-LICENSE.md`](data-evidence/nasa-worldview-LICENSE.md). They are research references, not implementation code imported into Teller Tactical. The full attribution review and license/content hashes are recorded in [`data-evidence/license-review.json`](data-evidence/license-review.json), [`data-evidence/ATTRIBUTION.md`](data-evidence/ATTRIBUTION.md), and the evidence manifest.

## Adapter acceptance and metadata contract

Every frame/forecast should retain source/product ID, observation or initialization time with its semantic label, forecast valid interval if applicable, retrieval time, requested time separately, projection, bounds, delivered dimensions, units, resolution when supported, quality flags, and coverage limitations. Unknown metadata stays unknown. Display times in `America/Denver` while preserving UTC internally.

Test the adapter against actual metadata, then deterministic fixtures: known-location registration; EPSG:3857 tile bounds and antimeridian behavior; WMS axis order; null-versus-zero values; 5-minute availability gaps; stale latest frames; malformed JSON/XML/image responses; interrupted transfers; bounded retries/cache; alerts that expire while offline; DST transitions; and non-overlapping forecast accumulation windows. A fixture test is evidence of deterministic behavior, not live availability.
