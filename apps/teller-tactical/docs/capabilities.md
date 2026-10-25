# Capability and verification matrix

This is an implementation/evidence register, not a WSV3 parity claim. Statuses are **Implemented and verified**, **Implemented but not verified on target hardware**, **In progress**, **Blocked**, and **Planned**. Fixture success does not establish real-source behavior. Linux success does not establish Apple Silicon behavior. Native Apple Silicon CI has demonstrated real-data rendering and playback, but the complete release gate **failed**. Current native-probe and satellite-color-map additions await a new Mac run. This is not a ready-for-use release.

## Research and foundation

| Capability | Status | Evidence / limitation |
| --- | --- | --- |
| Preserve REA fork, changes, and upstream tool role | Implemented and verified | Canonical independent sibling application; authorized additive `teller-tactical-release` branch hosts `apps/teller-tactical` and Mac CI; REA main unchanged |
| A real REA analysis operation | Implemented and verified | [Electron fuse evidence](evidence/rea-electron-fuses.json), actual installed Electron ELF inspected and SHA256 retained; this is not WSV3 analysis |
| WSV3 available/demonstrated/announced classification | Blocked | Official origin proxy403; no page/demonstration content retrieved; [research register](research.md) |
| Targeted WSV3 binary/static/runtime investigation | Blocked | No authorized WSV3 binary identified; Windows runtime may be needed for later runtime questions |
| Durable ledger, ADRs, source registry and checklist | Implemented and verified | LEDGER.md, ARCHITECTURE.md, data-sources.md, RELEASE.md |
| Independent ingestion and application code | Implemented and verified | No WSV3 backend, code, art, credential or binary dependency |
| Apple Silicon package generation and native launch | Implemented and verified | Native `macos-15` Darwin/arm64 launch with hardware GPU in run 40244655567; complete acceptance failed. Current source additions still require rerun |

## Core workstation

| Capability | Status | Evidence / limitation |
| --- | --- | --- |
| Launch → real data → georeferenced render → animate → inspect → refresh | In progress | Native Mac launch, real radar/visible/IR/NWS rendering and playback succeeded; legends and post-startup catalog aging failed the full gate. New probe/legend paths require live Mac validation |
| Reflectivity provider mosaic adapter | Implemented and verified | Real IEM radar imagery and playback rendered on native Apple Silicon in run 40244655567; provider composite, not raw single-site radar; full release acceptance remains outstanding |
| Nationwide radar site inventory/camera selection | Implemented but not verified on target hardware | NWS inventory adapter and real-coordinate normalization tested; fixture site camera/marker tested. Selection does not turn a mosaic into a site sweep |
| Raw single-site reflectivity/velocity/dual polarization | Planned | Selected mosaic source exposes none of these as implemented products; no inactive product controls |
| Source-time looping, scrubbing and actual-frame attribution | Implemented and verified | Browser fixture pixels/time change; old image/time/product retained on failed replacement; bounded frame lifecycle tests |
| Missing/partial loops and stale cached imagery | Implemented and verified | Total failed-frame retention, partial-request status, source-cache persistence and interruptions tested with deterministic sources |
| Numerical radar probing | Implemented but not verified on target hardware | Original indexed IEM N0Q PNG plus archive worldfile; nearest native cell, 0.5 dBZ quantization, source/frame/cell provenance and bounded worker. Index zero is nonquantitative; never invert displayed RGB. Newly integrated path awaits live Mac validation |
| Authentic radar/satellite legends | In progress | Native run exposed satellite legend HTTP 404. Source now supports advertised GIBS color-map labels/colors/units as well as image legends; correction awaits live Mac acceptance |
| Site distance/beam/terrain limitations | Implemented and verified | Geodesic distance guide tested, explicitly not guaranteed coverage; no unsupported terrain/beam-clearance calculation |
| Visible and IR satellite adapters | Implemented and verified | Real NASA GIBS visible/IR textures rendered on native Mac in run 40244655567; identity, source times and matrix geometry checked. Missing legends and later aging prevented complete release acceptance |
| Water-vapor satellite adapter | Implemented but not verified on target hardware | Admitted only if actual source identifier/title explicitly identify supported ABI water-vapor imagery; fixture product is synthetic, not a live proof |
| Satellite looping/registration | In progress | Shared renderer and metadata tests plus real visible/IR Mac textures; full loop/registration acceptance for the corrected source remains outstanding |
| Map navigation, coarse boundaries, town labels | Implemented and verified | Natural Earth offline outlines, public city coordinates, real rendered maps/screenshots, zoom/compass and camera tests |
| Live roads/basemap coverage | Implemented but not verified on target hardware | CARTO/OSM gateway adapter exists; complete coverage and current terms/limits verification remain outstanding |
| Weather opacity/product selection/visibility | Implemented and verified | Actual raster paint, observation/alert overlays and product changes tested. One weather raster product per pane; arbitrary stacking/reordering not implemented |
| Collapsible controls | Implemented and verified | Layers and point-weather panels toggle in actual UI; free-form docking is Planned |
| Keyboard shortcuts and saved cameras | Implemented and verified | Actual interactions, local saved-view/persistence tests; full versioned workspace export/import is Planned |
| Light/dark themes | Implemented and verified | Actual screenshots inspected; target high-DPI Mac typography is unverified |
| One/two/four maps and optional linked cameras/times | Implemented and verified | Actual fixture UI tests plus camera/renderer resource tests; peer timestamps remain explicit |
| Eight maps | Planned | Withheld until profiling supports it |
| Official alerts/observations adapters | In progress | Meaningful real NWS data rendered in native Mac acceptance; deterministic units/age/expiry/partial-failure contracts exist. This does not establish all live alert scenarios |
| Local alert expiry and stale indicators | Implemented and verified | Local expiry filter plus source expiration tests; current-source absence is not displayed as all-clear |
| Launch/use refresh, online/resume handlers | Implemented and verified | Browser interruption/reconnect paths tested; native physical sleep/wake remains unverified |
| Cancellable/deduplicated bounded persistent ingestion | Implemented and verified | Request deadlines, max bytes, concurrency4, dedup, retries, persistent256MiB cache eviction and stale fallback tests |
| Credentials | Implemented and verified | Implemented sources require no credentials. Optional credential products/storage are not implemented and do not prompt |

## Colorado mountain weather

| Capability | Status | Evidence / limitation |
| --- | --- | --- |
| Teller County / Colorado Springs / CONUS cameras | Implemented and verified | Actual UI region controls; city reference explicitly distinguished from property |
| Exact property coordinates/editable elevation | Implemented and verified | Initially unset coordinates and editable9200ft; actual UI save/clear/reload tests; no invented location |
| NWS point forecasts/nearby observations | Implemented and verified | Actual NWS data rendered on native Mac; source discovery, bounded station fanout and null/quality contracts tested. Full current release gate remains outstanding |
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
| Deterministic numerical/failure tests | Implemented and verified | Current local integration: 131 tests passed, zero failures/skips; build passed; 19/19 browser fixture groups passed. See VERIFICATION.md for scope and completion time; live Mac gate still outstanding |
| Separate live smoke runner | Implemented and verified | Fresh non-fixture source checks and actual native execution; failed full Mac run retained. Current source rerun remains outstanding |
| America/Denver display | Implemented and verified | Spring/fall DST cases tested; source timestamps remain UTC |
| Actual browser screenshots | Implemented and verified | Inspected real rendered fixture and offline screenshots; not WSV3 art and not live weather |
| Actual packaged Linux acceptance | Implemented and verified | Earlier fixture groups covered normal sandbox, real pixel changes, relaunch and quit/window-close flush. Revision-scoped Linux evidence is separate from later Mac work |
| Cold/warm/frame/memory/transfer metrics | In progress | Short synthetic software-GPU samples only; PERFORMANCE.md has exact limits;30-minute stability and Mac metrics unmeasured |
| macOS launch/packaged live workflow | In progress | Native Mac hardware-GPU launch, real radar/visible/IR/NWS and playback succeeded; run 40244655567 failed on legends and aging. Corrected integrated source awaits rerun |
| Signing/notarization | Blocked | Native runner reported zero valid code-signing identities. Current developer route uses ad-hoc signing; no Developer ID/notarization/stapling/Gatekeeper distribution acceptance or notarized user download |

Every remaining item is intentionally visible here. The partial native successes in [run 40244655567](https://github.com/tylerptt129/rea/actions/runs/40244655567) and earlier fixture packages do not fulfill complete operational release acceptance. See [VERIFICATION.md](VERIFICATION.md) for current source and evidence boundaries.
