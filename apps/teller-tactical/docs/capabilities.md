# Capability and verification matrix

This is an implementation/evidence register, not a WSV3 parity claim. Statuses are **Implemented and verified**, **Implemented but not verified on target hardware**, **In progress**, **Blocked**, and **Planned**. Fixture success does not establish real-source behavior. Linux success does not establish Apple Silicon behavior. The entire live vertical slice is still **Blocked**, so this is not a ready-for-use release.

## Research and foundation

| Capability | Status | Evidence / limitation |
| --- | --- | --- |
| Preserve REA fork, changes, and upstream tool role | Implemented and verified | tylerptt129/rea, branch work, HEAD80673b22; unchanged tracked/untracked status; independent sibling project |
| A real REA analysis operation | Implemented and verified | [Electron fuse evidence](evidence/rea-electron-fuses.json), actual installed Electron ELF inspected and SHA256 retained; this is not WSV3 analysis |
| WSV3 available/demonstrated/announced classification | Blocked | Official origin proxy403; no page/demonstration content retrieved; [research register](research.md) |
| Targeted WSV3 binary/static/runtime investigation | Blocked | No authorized WSV3 binary identified; Windows runtime may be needed for later runtime questions |
| Durable ledger, ADRs, source registry and checklist | Implemented and verified | LEDGER.md, ARCHITECTURE.md, data-sources.md, RELEASE.md |
| Independent ingestion and application code | Implemented and verified | No WSV3 backend, code, art, credential or binary dependency |
| Apple Silicon package generation | Implemented but not verified on target hardware | Unsigned ARM64 Mach-O bundle cross-builds on Linux; target launch/signing acceptance outstanding |

## Core workstation

| Capability | Status | Evidence / limitation |
| --- | --- | --- |
| Launch → real data → georeferenced render → animate → inspect → refresh | Blocked | Live sources denied by current proxy; deterministic synthetic slice works, which is a different result |
| Reflectivity provider mosaic adapter | Implemented but not verified on target hardware | Actual IEM archive scan discovery, absolute UTC WMS requests and EPSG3857 bounds; deterministic adapter tests pass; live imagery unverified |
| Nationwide radar site inventory/camera selection | Implemented but not verified on target hardware | NWS inventory adapter and real-coordinate normalization tested; fixture site camera/marker tested. Selection does not turn a mosaic into a site sweep |
| Raw single-site reflectivity/velocity/dual polarization | Planned | Selected mosaic source exposes none of these as implemented products; no inactive product controls |
| Source-time looping, scrubbing and actual-frame attribution | Implemented and verified | Browser fixture pixels/time change; old image/time/product retained on failed replacement; bounded frame lifecycle tests |
| Missing/partial loops and stale cached imagery | Implemented and verified | Total failed-frame retention, partial-request status, source-cache persistence and interruptions tested with deterministic sources |
| Numerical radar probing | Blocked | Rendered provider images do not expose source-precision measurements. UI states unavailable; never infer values from colors |
| Authentic radar/satellite legends | Implemented but not verified on target hardware | Gateway requests provider legend, no invented display-value mapping; actual legend availability unverified |
| Site distance/beam/terrain limitations | Implemented and verified | Geodesic distance guide tested, explicitly not guaranteed coverage; no unsupported terrain/beam-clearance calculation |
| Visible and IR satellite adapters | Implemented but not verified on target hardware | NASA GIBS C02/C13 identity, latency and delivered resolution documented; runtime validates timestamp catalog, WebMercator matrix geometry, tile URL and zoom support. Live availability blocked |
| Water-vapor satellite adapter | Implemented but not verified on target hardware | Admitted only if actual source identifier/title explicitly identify supported ABI water-vapor imagery; fixture product is synthetic, not a live proof |
| Satellite looping/registration | Implemented and verified | Shared renderer and XML/matrix/time tests; live satellite image registration/cadence still blocked |
| Map navigation, coarse boundaries, town labels | Implemented and verified | Natural Earth offline outlines, public city coordinates, real rendered maps/screenshots, zoom/compass and camera tests |
| Live roads/basemap coverage | Blocked | CARTO/OSM gateway adapter exists; current source access and terms/limits verification remain outstanding |
| Weather opacity/product selection/visibility | Implemented and verified | Actual raster paint, observation/alert overlays and product changes tested. One weather raster product per pane; arbitrary stacking/reordering not implemented |
| Collapsible controls | Implemented and verified | Layers and point-weather panels toggle in actual UI; free-form docking is Planned |
| Keyboard shortcuts and saved cameras | Implemented and verified | Actual interactions, local saved-view/persistence tests; full versioned workspace export/import is Planned |
| Light/dark themes | Implemented and verified | Actual screenshots inspected; target high-DPI Mac typography is unverified |
| One/two/four maps and optional linked cameras/times | Implemented and verified | Actual fixture UI tests plus camera/renderer resource tests; peer timestamps remain explicit |
| Eight maps | Planned | Withheld until profiling supports it |
| Official alerts/observations adapters | Implemented but not verified on target hardware | Units/location/elevation/age/expiry/provenance/partial-failure tests pass. Actual current source data still unverified |
| Local alert expiry and stale indicators | Implemented and verified | Local expiry filter plus source expiration tests; current-source absence is not displayed as all-clear |
| Launch/use refresh, online/resume handlers | Implemented and verified | Browser interruption/reconnect paths tested; native physical sleep/wake remains unverified |
| Cancellable/deduplicated bounded persistent ingestion | Implemented and verified | Request deadlines, max bytes, concurrency4, dedup, retries, persistent256MiB cache eviction and stale fallback tests |
| Credentials | Implemented and verified | Implemented sources require no credentials. Optional credential products/storage are not implemented and do not prompt |

## Colorado mountain weather

| Capability | Status | Evidence / limitation |
| --- | --- | --- |
| Teller County / Colorado Springs / CONUS cameras | Implemented and verified | Actual UI region controls; city reference explicitly distinguished from property |
| Exact property coordinates/editable elevation | Implemented and verified | Initially unset coordinates and editable9200ft; actual UI save/clear/reload tests; no invented location |
| NWS point forecasts/nearby observations | Implemented but not verified on target hardware | Point discovery, source URLs, bounded station fanout, partial successes and null/quality facts tested; live blocked |
| Elevation-aware comparison | Implemented and verified | User-minus-grid elevation only at the actual property point; no invented lapse-rate correction |
| Source precipitation-type/snow-level guidance | Implemented and verified | Displays available source categories/snow level with limitations; no independent precipitation-type model |
| Explicit QPF/snowfall accumulation windows | Implemented and verified | Complete non-overlapping intervals only; source units, gaps, nulls, cycle boundaries and reversed/absent window handling tested |
| Storm-ingredient inputs and wind/moisture context | Implemented and verified | Descriptive available NWS fields only; no upslope threshold, confidence score or snow ratio |
| Independent model initialization/cycle controls | Planned | NWS blended forecast issue time is not model initialization; source valid times retained |
| Multiple forecast-source comparison | Planned | Only NWS blended forecast adapter currently implemented |

## Advanced and release

| Capability | Status | Evidence / limitation |
| --- | --- | --- |
| PNG export | Implemented and verified | Actual file download with displayed product/time/source attribution |
| Animation export | Planned | Not exposed as a completed control |
| Terrain-aware3D / multi-source radar composition | Planned | Requires source/terrain validation and profiling after core live acceptance |
| Storm objects / extrapolation / nowcast | Blocked | No held-out historical validation dataset; no operational tracking/nowcast claim or control |
| Model precipitation/snowfall maps | Planned | Numerical source, cycle/valid times and explicit accumulation-map integration outstanding |
| Deterministic numerical/failure tests | Implemented and verified | Current count and commands in VERIFICATION.md; nonzero tests, zero skips |
| Separate live smoke runner | Implemented and verified | Fixture rejection and meaningful acceptance assertions tested; actual live run remains Blocked |
| America/Denver display | Implemented and verified | Spring/fall DST cases tested; source timestamps remain UTC |
| Actual browser screenshots | Implemented and verified | Inspected real rendered fixture and offline screenshots; not WSV3 art and not live weather |
| Actual packaged Linux acceptance | Implemented and verified | Five native fixture groups pass: normal sandbox, real frame/pixel changes, process relaunch and immediate quit/window-close preference flush. Live weather remains blocked |
| Cold/warm/frame/memory/transfer metrics | In progress | Short synthetic software-GPU samples only; PERFORMANCE.md has exact limits;30-minute stability and Mac metrics unmeasured |
| macOS launch/packaged live workflow | Blocked | Apple Silicon macOS host and successful public-source access are needed |
| Signing/notarization | Blocked | No macOS signing/notarization identity; unsigned/unverified cross-build clearly labeled |

Every remaining item is intentionally visible here. A successful fixture package does not fulfill the requested operational, real-data release acceptance.
