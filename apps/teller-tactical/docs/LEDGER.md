# Teller Tactical durable task ledger

## Identity and boundaries

Full scope: [REQUEST.md](REQUEST.md). REA is the existing fork **tylerptt129/rea**, branch `work`, HEAD `80673b22a46d01899718e22584cf95d9f0529ab7`. It remains unchanged. Teller Tactical is an independent local sibling repository `/workspace/teller-tactical`, branch `teller-tactical`. It has no GitHub remote; no source has been pushed or published. Source archive and cross-built packages are prepared locally for review.

## Current outcome

**The requested operational release is not complete.** A real application, data adapters, tests and packages exist, but live source acceptance and target-macOS acceptance remain blocked/unverified. Synthetic tests are prominently labeled and are never a production fallback. Read [capabilities.md](capabilities.md) for feature-by-feature status and [VERIFICATION.md](VERIFICATION.md) for evidence.

### Implemented and verified in this Linux environment

- Independent Electron desktop app and GPU MapLibre renderer; required worker bundled.
- Actual synthetic-frame textures, looping/scrubbing, per-view products, one/two/four maps, linked/unlinked cameras/times, source metadata, opacity, observation/alert overlays, site camera guides, collapsed panels, themes, saved cameras, PNG export and keyboard controls.
- Exact property entry is initially unset; editable9200ft initial elevation. Elevation comparison only applies to the matching actual selected property point.
- NWS point/forecast/grid/observation/alert adapters with source units/times/quality facts and partial failure preservation; complete-window precipitation accumulation and descriptive available mountain-weather inputs.
- IEM actual scan-list discovery and georeferenced WMS tile adapter; NASA GIBS source-time/matrix/projection-validated satellite adapter and source legends. Their deterministic contracts pass; actual live behavior remains unverified.
- Bounded/deduplicated/cancellable persistent ingestion, stale fallbacks, missing-frame retention with original source attribution, explicit offline states, local alert expiry, and serialized preference writes.
-61 deterministic tests pass with zero skips.18 browser fixture acceptance groups pass, including every exposed core control and interrupted/partial feeds. Real screenshots inspected, including corrected light-theme contrast.
- REA performed a real Electron fuse inspection; evidence retained. This is not WSV3 analysis.
- Frozen npm installation/build and pinned Electron checksum installation reproduced. Required setup/startup instructions and network requirements saved in the environment draft; saving does not apply or publish them.

### Release evidence

See [RELEASE.md](RELEASE.md), [PERFORMANCE.md](PERFORMANCE.md), and `docs/verification/`. Five native Linux fixture groups and the built-in screenshot harness pass: actual pixels, sandbox, preference restoration, immediate quit/window-close saves. Native main-script-to-stable-ready was3410ms on this software-rendered host; it is not an OS cold launch or Mac benchmark. Unsigned Apple Silicon bundle generation is distinct from a target launch. Final package/archive digests are retained with release outputs.

### Blocked

1. **Current environment network:** official WSV3 and weather/map origins returned proxy403. Runtime spec revision1 still has no custom allowed hosts; the saved draft contains required destinations. User must review/save relevant environment settings so runtime policy can apply. Do not bypass the proxy or repeat unchanged failures.
2. **Actual live vertical slice:** real metadata → pixels → loop → timestamps → refresh → outage recovery has not passed. Run the real smoke and packaged live acceptance after access is applied; investigate genuine endpoint/schema/capability differences, especially satellite subdaily availability. Do not infer observation times from static date ranges.
3. **Mac target:** no Apple Silicon/macOS execution environment exists here. The generated ARM64 app is unsigned, not notarized, and unverified on target. Run full core acceptance on an actual Mac; signing/notarization also require authorized Apple tooling/identity.
4. **Reference depth:** WSV3 official-origin content was not retrieved and no authorized reference binary was identified. Available/demonstrated/announced functionality stays unknown. Later binary/runtime work may need Windows and an authorized executable.

### Planned after core live acceptance

Raw single-site velocity/dual polarization and numerical probing; terrain3D; arbitrary layer stacking/docking; multiple model sources/cycles and forecast maps; storm tracking/nowcast with held-out historical validation; full workspace import/export and animation export; eight-map profiling. These have no nonfunctional product controls pretending completion.

## Next unfinished task

1. Apply the saved network settings, inspect current runtime readiness, and retry the specific official pages and data operations.
2. From this checkout with the pinned tools active: `npm run test:live`. It uses a fresh non-fixture cache, requires actual source frames/PNG tiles and meaningful NWS forecasts/observations/alert metadata, and fails on empty/stale/synthetic results.
3. Fix supported adapter/runtime integration issues using actual source responses; never fabricate available times, raw values, model cycles, coverage or confidence.
4. Run the actual packaged application with live sources; verify refresh, interruption/reconnection, local preferences and visible source/time/legend alignment. Record separate results.
5. Run the Mac build/launch/core tests and high-DPI/GPU/performance protocol, then decide signing/distribution. Resume advanced implementation only after the core live gate works.

## Resume without starting over

Read AGENTS.md, this ledger, the capability matrix, ADRs and source registry; inspect both Git statuses. Use existing isolated checkouts, not a new worktree unless requested. Preserve local-only application commits and artifacts. All screenshots with fixture labels are synthetic tests; they are not reference screenshots or live-weather proof. Do not claim publication or a clean-machine restore until it is independently tested.

## Mac completion follow-up

The user authorized the recommended native Apple Silicon GitHub Actions route. The verified hosting repository `tylerptt129/rea` is public; standard hosted `macos-15` is ARM64 and public-runner use requires no subscription purchase. A dedicated additive `teller-tactical-release` branch will retain REA and place this application under `apps/teller-tactical`, with a branch-specific workflow. REA's main branch remains unchanged.

New release gates build/sign locally on macOS, verify the Mach-O architecture and bundle signature, run native default-GPU fixture acceptance, backend real-data acceptance, and actual packaged radar/satellite/NWS playback/refresh/recovery. Developer artifacts are explicitly not notarized. A distribution artifact requires an existing Developer ID identity, Apple-accepted notarization, stapling and positive Gatekeeper assessment; no credentials are invented or exported.

Related source fixes now validate image/JSON/XML admission before persistent cache replacement and recover poisoned legacy cache entries. Satellite availability uses NASA's actual DescribeDomains metadata instead of treating broad calendar extents as observation frames. These have deterministic regressions; live claims await real execution.
