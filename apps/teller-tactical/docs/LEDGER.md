# Teller Tactical durable task ledger

## Identity and boundaries

Full scope: [REQUEST.md](REQUEST.md). REA remains the existing fork **tylerptt129/rea** and a separate research tool. The canonical independent application checkout is `/workspace/teller-tactical`, branch `teller-tactical`. With explicit user authorization, application source and a native Mac workflow were pushed additively to **tylerptt129/rea**, branch **teller-tactical-release**, under **apps/teller-tactical**. REA main remains untouched; this is not a merge to main or a public application release.

## Current outcome

**The requested operational release is not complete.** The application has now run natively on Apple Silicon with hardware GPU rendering and actual weather sources. The full native release gate has not passed, and there is no notarized user download. Synthetic tests remain conspicuously labeled and are never a production fallback. Read [capabilities.md](capabilities.md) and [VERIFICATION.md](VERIFICATION.md) for the distinction between implemented code, passing checks, and outstanding acceptance.

### Implemented application

- Independent Electron desktop app and MapLibre GPU maps with the renderer worker bundled.
- Per-pane radar/satellite selection, looping/scrubbing, one/two/four maps, linked cameras/times, opacity, source metadata, observations/alerts, site camera guides, themes, saved cameras, keyboard controls and PNG export.
- Initially unset property coordinates and editable 9,200-foot initial elevation; elevation comparison applies only at the actual selected property point.
- NWS point/forecast/grid/observation/alert adapters with source units, times, quality and partial failures; complete-window precipitation accumulation and descriptive mountain-weather inputs.
- IEM actual archive scan discovery and georeferenced WMS imagery; NASA GIBS timestamp/matrix/projection-validated satellite discovery using actual DescribeDomains availability.
- Bounded, cancellable, deduplicated persistent ingestion, validated cache admission, poisoned-cache recovery, stale fallback and serialized preferences.
- Newly integrated numerical probing of original IEM N0Q indexed PNG cells using source worldfiles. It reports native 0.5 dBZ classes, nominal mosaic time, cell registration and limitations; index zero has no quantitative value. This is a provider composite, not raw single-site radar or display-color inversion.
- Newly integrated satellite legends derived from provider-advertised GIBS color-map metadata when the source advertises no supported legend image. Source labels, units and colors are preserved; no synthetic physical mapping is invented.

The probe and color-map additions have not yet been validated in a new live Mac run. The current local integration run passed `npm test` with 135 tests, zero failures/skips, `npm run build`, and all 19 browser fixture acceptance groups (completed 2026-10-25T23:52:06.336Z). These results include the integrated source but do not establish live Mac behavior. Earlier Linux packaged results retain their original scope.

### Native Mac progress

The user explicitly authorized the native Apple Silicon GitHub Actions route and resumed the workflow. The additive branch uses `macos-15`, requires actual Darwin/arm64, builds on macOS, ad-hoc signs the developer bundle, and runs package, fixture, backend-live and packaged-live gates.

[Run 40244655567](https://github.com/tylerptt129/rea/actions/runs/40244655567) **failed overall**. It demonstrated native launch, hardware GPU rendering, real radar and visible/infrared satellite textures, meaningful NWS data and radar playback after a strictly fresh startup. Missing satellite legends returned HTTP 404, and catalog aging after startup caused further acceptance failure. Those are concrete source/integration findings, not an absent Mac host or a blanket network denial.

Source corrections now handle advertised color maps and distinguish verified-fresh startup from subsequent visibly aged observations. They require another native run. No later Mac success is implied by the local additions. The runner reported **zero valid code-signing identities**; only an ad-hoc developer candidate is available through the current route. No Developer ID/notarized distribution has been produced.

### Other retained evidence

REA performed a real Electron fuse inspection; [evidence](evidence/rea-electron-fuses.json) is retained. This is not WSV3 binary analysis. Locked installation, build, deterministic source contracts, browser fixture interactions and native Linux fixture behavior have earlier recorded results in `docs/verification/` and `test-results/`; they do not establish current Mac acceptance. See [RELEASE.md](RELEASE.md) and [PERFORMANCE.md](PERFORMANCE.md) for exact boundaries.

### Outstanding

1. Retain the completed local integration evidence (135 deterministic tests, production build and 19 browser fixture groups); do not relabel older archived results as the current run.
2. Publish the completed application changes to the authorized additive branch and run native Apple Silicon acceptance again. Confirm source legends, native-cell probes, refresh, outage recovery and visible aging with real sources.
3. Keep startup freshness budgets strict. An observation that ages during a test must retain its time and become visibly stale/unavailable; a passed fresh startup does not establish later source freshness.
4. Complete target high-DPI/GPU/performance and prolonged-playback evidence, including physical sleep/wake where applicable. Short CI execution is not a user-hardware benchmark.
5. The new `npm run install:mac` user-local installer is implemented, but its successful native copy/relaunch path awaits CI. It preserves an existing app as a timestamped backup and retains normal OS protections. Signing/notarization require an authorized installed Developer ID identity and existing Apple notarization configuration. The current runner has neither a usable distribution identity nor a notarized result.
6. WSV3 official-origin research remains incomplete and no authorized reference executable has been identified. Available/demonstrated/announced reference behavior stays unknown where evidence is absent.

### Planned after core live acceptance

Raw single-site velocity/dual polarization; terrain 3D; arbitrary layer stacking/docking; multiple model sources/cycles and forecast maps; storm tracking/nowcast with held-out historical validation; full workspace import/export and animation export; eight-map profiling. Numerical N0Q composite probing is now implemented in source and no longer belongs in this planned list.

## Resume without starting over

Read AGENTS.md, this ledger, the capability matrix, ADRs and source registry; inspect both Git statuses. Use existing isolated checkouts, not a new worktree unless requested. Preserve local-only application commits and artifacts. The canonical app checkout and additive CI checkout have distinct roles; do not overwrite REA main. Record every native run with its commit, run URL and stage results. Fixture screenshots are synthetic tests, not reference screenshots or live-weather proof. Do not claim a completed release, notarization, publication, or clean-machine restore without independent evidence.
