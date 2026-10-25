# Teller Tactical

An independent Colorado-first desktop weather workstation. REA remains untouched in the sibling checkout. Read [the capability matrix](docs/capabilities.md) before interpreting the scope: **this build is not yet operationally validated or ready for weather decisions**. A native Apple Silicon CI run has launched the application with hardware GPU rendering and real radar, visible/IR satellite, NWS data, and playback, but the complete release gate failed. Current probe and satellite-legend fixes still require a new Mac run; fixture tests do not establish live reliability.

## Install and run on an Apple Silicon Mac

Build from this source with Node.js 24.22.1 or later. There is no accepted notarized user download yet:

```sh
npm ci
npm exec install-electron
npm run build
npm start
```

No weather credentials are required by the implemented public-source adapters. Keep Internet access available for IEM, NWS, NASA GIBS (when a trustworthy satellite catalog is returned), and the CARTO/OSM basemap. No WSV3 private server is used. Do not disable Gatekeeper or other OS protections. The earlier Linux cross-build is unsigned. The authorized native `macos-15` workflow builds an ad-hoc developer candidate; its runner reported zero valid code-signing identities. Ad-hoc signing is not Developer ID signing or notarization. A user-local source build remains supported without a Developer ID identity; keep normal macOS security protections enabled. Full native acceptance and signed distribution remain outstanding. See [native Mac progress](docs/VERIFICATION.md#native-apple-silicon-progress).

## Local Mac installation

On an Apple Silicon Mac, use the additive release branch and install the pinned dependencies:

```sh
git clone --branch teller-tactical-release --single-branch https://github.com/tylerptt129/rea.git
cd rea/apps/teller-tactical
npm ci
npm exec install-electron
npm run install:mac
```

`install:mac` builds an ad-hoc developer bundle, runs native acceptance, verifies the copied signature and executable/ASAR fingerprints, then installs into `~/Applications/Teller Tactical.app` and opens it. An existing installation is retained as a timestamped backup. No Developer ID identity is needed for this local source route; normal macOS security protections remain enabled. Required source/acceptance failures stop installation. This is not a notarized download or an operational-readiness claim.

After an already passing native release, `npm run install:mac -- --from-verified` reuses only the exact validated bundle. Use `--destination /absolute/user/directory` to select another directory within your home or temporary storage, and `--no-open` for automation. The result is written to `release/macos-verification/installed-local.json`.

## First launch

1. The default camera covers Teller County and the Colorado Springs area; the initial forecast is explicitly a Colorado Springs city reference. The app does not know your property location.
2. Open **Set property coordinates**, enter your actual latitude/longitude, and replace the editable 9,200-foot initial elevation if appropriate. Settings stay on your machine. The forecast request sends the selected coordinates to NWS.
3. Verify the source status and displayed frame time. **WEATHER UNAVAILABLE**, **STALE / CACHED**, **PARTIAL FRAME**, and **SYNTHETIC TEST DATA** are meaningful conditions; none means live, complete coverage.
4. Select a product in the upper right of each map. Use the bottom timeline, spacebar, or arrows to play and scrub. The timestamp changes only after the frame is displayed. Linked timelines choose the latest available peer frame at or before the selected time; peer timestamps can differ.
5. Choose 1/2/4 maps and link cameras as needed. Click the map for a point forecast and, for supported IEM N0Q frames, a source-native radar sample. Probes read the original indexed composite and worldfile, retain nominal source time, and report 0.5 dBZ quantization and coverage limits. Unsupported imagery and index-zero cells report no quantitative value. The new probe has not yet passed live Mac acceptance; displayed RGB colors are never inverted into measurements.
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
npm run package:mac    # ARM64 package; packaging alone does not pass release gates
npm run package:linux  # Linux x64 validation package
```

Use `TELLER_FIXTURE=1 npm start` only for the conspicuously synthetic demonstration/test workspace. Never use fixture output for weather decisions. Production mode never substitutes synthetic weather when public data fails.

The application is also hosted additively at `apps/teller-tactical` on the authorized [`teller-tactical-release` branch](https://github.com/tylerptt129/rea/tree/teller-tactical-release/apps/teller-tactical). REA main remains unchanged. [Run 40244655567](https://github.com/tylerptt129/rea/actions/runs/40244655567) failed on missing satellite legends and catalog aging after a fresh startup; it is progress evidence, not release approval.

## Data and research

- [Data-source register](docs/data-sources.md): authoritative metadata, product meaning, projections, cadence, limitations, and current terms-verification boundary.
- [Reference research](docs/research.md): what was actually investigated, including blocked WSV3 access and absence of a reference binary. No WSV3 binary analysis is claimed.
- [Architecture decisions](docs/ARCHITECTURE.md) and [full request](docs/REQUEST.md).

Map context includes public-domain Natural Earth boundaries, CARTO basemaps, and OpenStreetMap attribution. Dependencies and their licenses are retained in the lockfile and distributed packages. Weather products retain provider attribution. Teller Tactical does not redistribute WSV3 code, assets, executables, or credentials.
