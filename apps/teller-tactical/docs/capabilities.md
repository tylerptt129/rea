# Capability and verification matrix

This is an implementation/evidence register, not a WSV3 parity claim. Statuses are **Implemented and verified**, **Implemented but not verified on target hardware**, **In progress**, **Blocked**, and **Planned**. Fixture success does not establish real-source behavior. Linux success does not establish Apple Silicon behavior. The core live workflow and user-local installation **passed** on macOS 15.7.9 arm64 in [run 40247555425](https://github.com/tylerptt129/rea/actions/runs/40247555425). The remaining advanced features, long-duration performance validation and notarized distribution are tracked separately below.

## Research and foundation

| Capability | Status | Evidence / limitation |
| --- | --- | --- |
| Preserve REA fork, changes, and upstream tool role | Implemented and verified | Canonical independent sibling application; authorized additive `teller-tactical-release` branch hosts `apps/teller-tactical` and Mac CI; REA main unchanged |
| A real REA analysis operation | Implemented and verified | [Electron fuse evidence](evidence/rea-electron-fuses.json), actual installed Electron ELF inspected and SHA256 retained; this is not WSV3 analysis |
| WSV3 available/demonstrated/announced classification | Blocked | Official origin proxy403; no page/demonstration content retrieved; [research register](research.md) |
| Targeted WSV3 binary/static/runtime investigation | Blocked | No authorized WSV3 binary identified; Windows runtime may be needed for later runtime questions |
| Durable ledger, ADRs, source registry and checklist | Implemented and verified | LEDGER.md, ARCHITECTURE.md, data-sources.md, RELEASE.md |
| Independent ingestion and application code | Implemented and verified | No WSV3 backend, code, art, credential or binary dependency |
| Apple Silicon package generation and native launch | Implemented and verified | Native build/ad-hoc signature and hardware-GPU launch passed on macOS 15.7.9 arm64, run 40247555425; this is a developer build, not notarized distribution |

## Core workstation

| Capability | Status | Evidence / limitation |
| --- | --- | --- |
| Launch → real data → georeferenced render → animate → inspect → refresh | Implemented and verified | 7 packaged-live groups passed: recent radar/NWS/visible/IR, ASAR native probe, playback, refresh and 116-second interruption/recovery. Run-specific source health within-startup-budgets, no warnings |
| Reflectivity provider mosaic adapter | Implemented and verified | Real IEM imagery/playback passed native Mac acceptance; provider composite, not raw single-site radar. Strict radar startup budget remains 20 minutes |
| Nationwide radar site inventory/camera selection | Implemented but not verified on target hardware | NWS inventory adapter and real-coordinate normalization tested; fixture site camera/marker tested. Selection does not turn a mosaic into a site sweep |
| Raw single-site reflectivity/velocity/dual polarization | Planned | Selected mosaic source exposes none of these as implemented products; no inactive product controls |
| Source-time looping, scrubbing and actual-frame attribution | Implemented and verified | Browser fixture pixels/time change; old image/time/product retained on failed replacement; bounded frame lifecycle tests |
| Missing/partial loops and stale cached imagery | Implemented and verified | Total failed-frame retention, partial-request status, source-cache persistence and interruptions tested with deterministic sources |
| Numerical radar probing | Implemented and verified | Original indexed N0Q PNG/worldfile and ASAR worker passed on Mac. Real frame 202610260000 returned native index 0 → unavailable/null; no nonzero live value observed. Quantized mapping/registration verified separately by deterministic and packaged fixtures; never invert RGB |
| Authentic radar/satellite legends | Implemented and verified | Final native live acceptance passed with source image legends and advertised GIBS color-map labels/colors/units; source mapping is retained |
| Site distance/beam/terrain limitations | Implemented and verified | Geodesic distance guide tested, explicitly not guaranteed coverage; no unsupported terrain/beam-clearance calculation |
| Visible and IR satellite adapters | Implemented and verified | Real NASA GIBS visible/IR textures, source-time/matrix/identity and legend checks passed on native Mac. Strict satellite startup budget remains 70 minutes |
| Water-vapor satellite adapter | Implemented but not verified on target hardware | Admitted only if actual source identifier/title explicitly identify supported ABI water-vapor imagery; fixture product is synthetic, not a live proof |
| Satellite looping/registration | Implemented and verified | Source projection/matrix/time contracts and real visible/IR texture rendering passed; broader geographic/visual calibration remains outside this run |
| Map navigation, coarse boundaries, town labels | Implemented and verified | Natural Earth offline outlines, public city coordinates, real rendered maps/screenshots, zoom/compass and camera tests |
| Live roads/basemap coverage | Implemented but not verified on target hardware | CARTO/OSM gateway adapter exists; complete coverage and current terms/limits verification remain outstanding |
| Weather opacity/product selection/visibility | Implemented and verified | Actual raster paint, observation/alert overlays and product changes tested. One weather raster product per pane; arbitrary stacking/reordering not implemented |
| Collapsible controls | Implemented and verified | Layers and point-weather panels toggle in actual UI; free-form docking is Planned |
| Keyboard shortcuts and saved cameras | Implemented and verified | Actual interactions, local saved-view/persistence tests; full versioned workspace export/import is Planned |
| Light/dark themes | Implemented and verified | Actual screenshots inspected; target high-DPI Mac typography is unverified |
| One/two/four maps and optional linked cameras/times | Implemented and verified | Actual fixture UI tests plus camera/renderer resource tests; peer timestamps remain explicit |
| Eight maps | Planned | Withheld until profiling supports it |
| Official alerts/observations adapters | Implemented and verified | Native real NWS checks plus deterministic units/age/expiry/partial-failure contracts passed. No claim to every live alert scenario |
| Local alert expiry and stale indicators | Implemented and verified | Local expiry filter plus source expiration tests; current-source absence is not displayed as all-clear |
| Launch/use refresh, online/resume handlers | Implemented and verified | Native live refresh and 116-second interruption/recovery passed; browser outage cases passed. Physical sleep/wake remains unverified |
| Cancellable/deduplicated bounded persistent ingestion | Implemented and verified | Request deadlines, max bytes, concurrency4, dedup, retries, persistent256MiB cache eviction and stale fallback tests |
| Credentials | Implemented and verified | Implemented sources require no credentials. Optional credential products/storage are not implemented and do not prompt |

## Colorado mountain weather

| Capability | Status | Evidence / limitation |
| --- | --- | --- |
| Teller County / Colorado Springs / CONUS cameras | Implemented and verified | Actual UI region controls; city reference explicitly distinguished from property |
| Exact property coordinates/editable elevation | Implemented and verified | Initially unset coordinates and editable9200ft; actual UI save/clear/reload tests; no invented location |
| NWS point forecasts/nearby observations | Implemented and verified | Actual NWS data passed native live acceptance; source discovery, bounded station fanout and null/quality contracts tested |
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
| Deterministic numerical/failure tests | Implemented and verified | 135 native source tests passed; local build and 19/19 browser fixture groups passed. VERIFICATION.md records separate scopes |
| Separate live smoke runner | Implemented and verified | 3 backend real-source and 7 native packaged-live groups passed with explicit non-fixture data; retained failures are historical |
| America/Denver display | Implemented and verified | Spring/fall DST cases tested; source timestamps remain UTC |
| Actual browser screenshots | Implemented and verified | Inspected real rendered fixture and offline screenshots; not WSV3 art and not live weather |
| Actual packaged Linux acceptance | Implemented and verified | Earlier fixture groups covered normal sandbox, real pixel changes, relaunch and quit/window-close flush. Revision-scoped Linux evidence is separate from later Mac work |
| Cold/warm/frame/memory/transfer metrics | In progress | Native CI readiness/resource observations are recorded; calibrated Mac FPS and a 30-minute playback/memory soak remain unmeasured. See PERFORMANCE.md |
| macOS launch/packaged live workflow | Implemented and verified | Run 40247555425 passed on macOS 15.7.9 arm64: normal hardware GPU, 5 native fixture groups and 7 packaged-live groups |
| User-local Mac installation | Implemented and verified | Safe copy, strict copied signature/hash verification and installation passed; installed app passed 5 fixture groups. Source route needs no paid Apple account |
| Signing/notarization | Blocked | Ad-hoc signatures verified; runner had zero Developer ID identities, distributionReady:false. No notarization/stapling/Gatekeeper distribution acceptance or notarized user download |

The successful core gate does not complete the advanced wishlist or establish notarized distribution, a nonzero live numerical measurement, or calibrated long-duration performance. See [VERIFICATION.md](VERIFICATION.md) for accepted commits, exact results and historical failures.
