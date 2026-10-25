# Third-party notices

- MapLibre GL JS (BSD-3-Clause), https://github.com/maplibre/maplibre-gl-js. Its copyright/license text remains in the bundled library and dependency distribution.
- Electron (MIT), https://github.com/electron/electron. Packaged runtimes include their LICENSE and LICENSES.chromium.html; Chromium has additional component licenses in that file.
- undici (MIT), https://github.com/nodejs/undici.
- fast-xml-parser (MIT), https://github.com/NaturalIntelligence/fast-xml-parser.
- Natural Earth public-domain map boundaries: https://www.naturalearthdata.com/about/terms-of-use/. Source GeoJSON: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_1_states_provinces.geojson. Only United States state features and their names were retained; these coarse outlines do not define property or parcel boundaries.
- OpenStreetMap contributors: https://www.openstreetmap.org/copyright (ODbL data); CARTO basemap attribution is displayed on the map and exported images. Current service terms and limits still require origin access verification before release.
- NOAA/NWS, NASA GIBS and Iowa Environmental Mesonet product references and evidence are in docs/data-sources.md. IEM composites are derived provider mosaics, not raw site measurements. Public availability does not establish a guaranteed operational service level.

The package lockfile records exact direct and transitive dependency identities. Runtime dependency license files and Electron notices are included in the unpacked application bundle. No proprietary WSV3 material is included.

Research evidence artifacts have their own upstream terms: IEM's retained MIT-form notice and NASA Worldview's NOSA1.3 notice are in docs/data-evidence/. NWS schema research is retained as minimal factual metadata and immutable source hashes/URLs rather than a full unlicensed source copy. See docs/data-evidence/ATTRIBUTION.md and license-review.json. The root MIT license covers Teller Tactical's original code, not these separately attributed materials.
