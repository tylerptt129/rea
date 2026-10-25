# Teller Tactical

An independent Colorado-first desktop weather workstation. REA remains untouched in the sibling checkout. Read [the capability matrix](docs/capabilities.md) before interpreting the scope: **this build is not yet operationally validated or ready for weather decisions**. Public weather/source access and target macOS testing are outstanding; fixture tests do not establish live reliability.

## Install and run on an Apple Silicon Mac

Use the unsigned ARM64 `.app` in `release/Teller Tactical-darwin-arm64/` when available, or build from this source with Node.js 24.22.1 or later:

```sh
npm ci
npm exec install-electron
npm run build
npm start
```

No weather credentials are required by the implemented public-source adapters. Keep Internet access available for IEM, NWS, NASA GIBS (when a trustworthy satellite catalog is returned), and the CARTO/OSM basemap. No WSV3 private server is used. Do not disable Gatekeeper or other OS protections. The cross-built macOS app is unsigned, not notarized, and **has not been launched on macOS**. Building from source on your Mac is the supported development route until a signed release and target acceptance pass are available.

## First launch

1. The default camera covers Teller County and the Colorado Springs area; the initial forecast is explicitly a Colorado Springs city reference. The app does not know your property location.
2. Open **Set property coordinates**, enter your actual latitude/longitude, and replace the editable 9,200-foot initial elevation if appropriate. Settings stay on your machine. The forecast request sends the selected coordinates to NWS.
3. Verify the source status and displayed frame time. **WEATHER UNAVAILABLE**, **STALE / CACHED**, **PARTIAL FRAME**, and **SYNTHETIC TEST DATA** are meaningful conditions; none means live, complete coverage.
4. Select a product in the upper right of each map. Use the bottom timeline, spacebar, or arrows to play and scrub. The timestamp changes only after the frame is displayed. Linked timelines choose the latest available peer frame at or before the selected time; peer timestamps can differ.
5. Choose 1/2/4 maps and link cameras as needed. Click the map for a point forecast. Source details explain imagery type and limits; numerical raster-color probing is deliberately unavailable.
6. Use **Diagnostics** if feeds fail. **Refresh** retries sources. Last-known cached responses retain original retrieval/observation times and are marked stale on failed refresh.

NWS forecast update times are not numerical model initialization times. Accumulations require a complete selected set of source intervals; incomplete totals remain unavailable. There is no custom snow ratio, upslope threshold, confidence score, storm tracking, or validated nowcast.

## Browser development and tests

The same bundled UI can run from the local gateway. Build before starting it:

```sh
npm run build
TELLER_DATA_DIR=/absolute/writable/path npm run dev
# Gateway binds only to 127.0.0.1 (default port 4173).
npm test
npm run test:ui
npm run test:live
```

`test:ui` uses local Chromium and explicit deterministic fixture mode; synthetic radar/satellite/forecasts are prominently labeled. `test:live` always uses a fresh non-fixture cache and fails when source access or meaningful checks fail. Neither tests Apple Silicon rendering. See [live acceptance](docs/LIVE-VALIDATION.md), [release requirements](docs/RELEASE.md), [performance evidence](docs/PERFORMANCE.md), and [task ledger](docs/LEDGER.md).

```sh
npm run package:mac    # ARM64 unsigned macOS application
npm run package:linux  # Linux x64 validation package
```

Use `TELLER_FIXTURE=1 npm start` only for the conspicuously synthetic demonstration/test workspace. Never use fixture output for weather decisions. Production mode never substitutes synthetic weather when public data fails.

## Data and research

- [Data-source register](docs/data-sources.md): authoritative metadata, product meaning, projections, cadence, limitations, and current terms-verification boundary.
- [Reference research](docs/research.md): what was actually investigated, including blocked WSV3 access and absence of a reference binary. No WSV3 binary analysis is claimed.
- [Architecture decisions](docs/ARCHITECTURE.md) and [full request](docs/REQUEST.md).

Map context includes public-domain Natural Earth boundaries, CARTO basemaps, and OpenStreetMap attribution. Dependencies and their licenses are retained in the lockfile and distributed packages. Weather products retain provider attribution. Teller Tactical does not redistribute WSV3 code, assets, executables, or credentials.
