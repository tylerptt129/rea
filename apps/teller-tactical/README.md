# Teller Tactical

An independent Colorado-first desktop weather workstation. **The core live Apple Silicon workflow and user-local installation passed native acceptance** on macOS 15.7.9 arm64 in [run 40247555425](https://github.com/tylerptt129/rea/actions/runs/40247555425). Real radar, visible/IR satellite, NWS data, playback, refresh and interruption/recovery were exercised with the normal hardware GPU and security path. See [verified capabilities and remaining features](docs/capabilities.md); advanced products and long-duration performance remain unfinished.

## Install on an Apple Silicon Mac

Use macOS 13 or later, Node.js 24.22.1 or a compatible newer version, npm (pinned to 11.16.0), Git, and Internet access. The recommended local source installation needs no paid Apple account or Developer ID identity:

```sh
git clone --branch teller-tactical-release --single-branch https://github.com/tylerptt129/rea.git teller-tactical-mac
cd teller-tactical-mac/apps/teller-tactical
npm ci
npm exec install-electron
npm run install:mac
```

The installer builds and ad-hoc signs the app, runs native acceptance, verifies the copied signature and executable/ASAR fingerprints, then installs `~/Applications/Teller Tactical.app` and opens it. It retains an existing installation as a timestamped backup. Source or acceptance failures stop installation. Normal macOS security protections remain enabled.

No weather credentials are required for implemented public products. Keep access available for IEM, NWS, NASA GIBS and the CARTO/OSM basemap. The application has its own local gateway and no WSV3 private-server dependency.

After a passing native release, `npm run install:mac -- --from-verified` reuses only the exact validated bundle. `--destination /absolute/user/directory` chooses another home/temporary directory; `--no-open` supports automation. The result is saved to `release/macos-verification/installed-local.json`.

A [validated developer artifact](https://github.com/tylerptt129/rea/actions/runs/40247555425/artifacts/12619009605) is available for inspection. It is **ad-hoc signed and not notarized**, with `distributionReady:false`; a downloaded copy may be rejected by normal macOS policy. Use the local source route above and retain security protections. See [release details and checksum](docs/RELEASE.md).

## First launch

1. The default camera covers Teller County and Colorado Springs; the initial forecast is a Colorado Springs city reference. The app does not know your property location.
2. Open **Set property coordinates**, enter your latitude/longitude, and replace the editable 9,200-foot elevation if needed. Settings stay locally; NWS receives the selected forecast coordinates.
3. Check source status and displayed frame time. **WEATHER UNAVAILABLE**, **STALE / CACHED**, **PARTIAL FRAME** and **SYNTHETIC TEST DATA** describe meaningful limitations. A successful test does not guarantee future source freshness or complete coverage.
4. Select a product in each map. Use the timeline, spacebar or arrows to play/scrub; timestamps follow displayed frames. Linked timelines select the latest available peer frame at or before the selected time, so peer timestamps can differ.
5. Choose 1/2/4 maps and camera links as needed. Click for a point forecast and a supported IEM N0Q source-native radar sample. Probes use indexed source cells/worldfiles with 0.5 dBZ quantization, never inverted display colors. Index zero reports unavailable/null; the successful live test encountered that case, not a nonzero numerical measurement.
6. Use **Diagnostics** for failures and **Refresh** to retry. Failed refreshes retain original cached source times and show stale status.

NWS forecast issue times are not model initialization times. Accumulations require complete source intervals. Raw single-site velocity/dual polarization, terrain 3D, model forecast maps, tracking and validated nowcasting remain unimplemented. There is no custom snow ratio, upslope threshold or confidence score. See [performance evidence](docs/PERFORMANCE.md) for the unmeasured calibrated frame-rate and 30-minute stability targets.

## Development and tests

From the application directory:

```sh
npm run build
npm start
# Browser-only gateway, bound to 127.0.0.1 (default port 4173):
TELLER_DATA_DIR=/absolute/writable/path npm run dev
npm test
npm run test:ui
npm run test:live
```

`test:ui` uses conspicuously labeled deterministic fixtures. `test:live` uses a fresh non-fixture cache and meaningful source assertions. Native Mac acceptance and installation are separate executed checks documented in [VERIFICATION.md](docs/VERIFICATION.md) and [LIVE-VALIDATION.md](docs/LIVE-VALIDATION.md).

```sh
npm run package:mac    # Packaging alone does not run the complete release gate.
npm run package:linux  # Linux x64 validation package.
```

`TELLER_FIXTURE=1 npm start` is solely a synthetic demonstration/test workspace. Production never substitutes synthetic weather when public sources fail.

## Data and research

The application is hosted additively at `apps/teller-tactical` on the authorized [`teller-tactical-release` branch](https://github.com/tylerptt129/rea/tree/teller-tactical-release/apps/teller-tactical). REA main remains unchanged.

- [Data-source register](docs/data-sources.md): product meaning, projections, timing, limitations and source terms-verification scope.
- [Reference research](docs/research.md): WSV3 source access remains blocked and no authorized reference binary was identified. No WSV3 binary analysis or parity claim is made.
- [Architecture decisions](docs/ARCHITECTURE.md), [task ledger](docs/LEDGER.md) and [full request](docs/REQUEST.md).

Natural Earth boundaries, CARTO basemaps and OpenStreetMap attribution provide map context. Weather attribution and dependency licenses are retained. Teller Tactical redistributes no WSV3 code, assets, executables or credentials.
