# Performance evidence and measurement protocol

Initial targets are approximately 60 fps during normal cached single-map navigation, smooth cached playback, fast warm launch, bounded transfer/cache size and stable memory during prolonged use. These are targets, **not measured guarantees**.

## Current environment

| Attribute | Known value / limit |
| --- | --- |
| Host | Managed Linux x86_64 cloud container |
| CPU | Cgroup quota 4 CPUs during initial setup; verify for each measurement |
| Memory | Cgroup limit 32 GiB during initial setup; verify for each measurement |
| Primary release target | Apple Silicon macOS; native CI executes on macos-15 Darwin/arm64, separate from this Linux host |
| Rendering implementation | Electron native window, Chromium renderer, MapLibre WebGL |
| Test display | Workspace-local Xvfb from signed Debian package 2:21.1.16-1.3+deb13u4; local-socket startup verified with supported command escalation |
| Live-data access | Managed cloud origins remain blocked; native Mac CI has fetched real radar/satellite/NWS data. See VERIFICATION.md for each full-gate outcome |
| Reference comparison | No WSV3 binary or runnable installation; comparative accuracy/speed unmeasured |

## Results

The current browser fixture run passed 19 functional groups; raw measurements are retained in [verification/ui-smoke.json](verification/ui-smoke.json) (2026-10-25T23:51:05Z–23:52:06Z). It used headless Chromium, a 1440×1000 CSS-pixel viewport at scale 1, a local deterministic synthetic Colorado field, and explicit SwiftShader software ANGLE. No actual remote weather bytes were fetched. Native Mac CI has separately rendered real weather with the default GPU path; this browser sample does not measure Mac performance.

The packaged Linux timings and process snapshots below retain the initial source/run scope; they are not measurements of every later source revision.

The initial packaged Linux attempt timed out at 20,304 ms with no usable canvas (`test-results/packaged-electron.json`); Electron reported WebGL2 blocklisted. Later worker/event-shape/readiness bugs were diagnosed and corrected rather than treating an optimistic readiness marker as proof of pixels. Initial failure evidence is retained in `test-results/packaged-workflow-bwti-failure.*` and `test-results/packaged-marker-race.*`. These failures are not successful launch-performance measurements. The native application keeps its normal Electron sandbox; software-backend switches are test-host launch arguments only.

| Scenario | Result | Scope/status |
| --- | --- | --- |
| OS cold launch to usable fixture map | Unmeasured | Requires external launcher timing and an explicit data/render marker |
| Warm launch to usable fixture map | Unmeasured | Same dataset/cache/window and machine required |
| Browser navigation to usable synthetic map | 2,917 ms | Browser already launched; fixture-only navigation timing, not desktop cold launch |
| Browser warm reload to usable synthetic map | 5,020 ms | Same fixture browser context; not native-process warm launch |
| Live first usable weather data | Recorded per native CI run | Packaged-live launchToUsableMs includes real startup/data; not a controlled cold/warm comparison |
| Native main script to stable renderer readiness | 3,410 ms | Final packaged fixture harness, Electron 45.0.0 / embedded Node 24.22.0, Linux Xvfb with software ANGLE; excludes OS process creation |
| Instrumented packaged process launches | 3,712 / 4,485 / 5,437 ms | Three fixture processes in native persistence test; saved camera/theme differ between runs, so these are not equivalent cold/warm comparisons |
| Native working-set snapshots | 674.8 / 692.0 / 682.1 MiB | Sum of Electron process RSS snapshots from the three instrumented runs; shared pages can be counted more than once and no prolonged stability is established |
| Idle one-map animation-frame callbacks | Median 16.7 ms; p95 16.8 ms; worst 16.8 ms; 0/120 above 33.34 ms | Callback cadence does not prove weather-frame updates or cached-navigation performance |
| Local fixture map pan | Median 16.7 ms; p95 166.7 ms; worst 300.0 ms; 17/120 above 33.34 ms | 4.329-second sample; surrounding tiles were not fully prewarmed. The tested pan missed a smooth 60-fps target. Fully cached navigation remains unmeasured. |
| Cached radar/satellite playback | Unmeasured | Include frame count, image dimensions, timeline cadence and partial-loop states |
| Two-/four-map synchronization | Unmeasured | Report each view's products, resolution and render cost |
| Prolonged playback memory | Unmeasured | Resource snapshots alone do not establish memory stability |
| Normal browser-fixture response payload | 4,986,957 declared bytes | Sum of response Content-Length values for local fixture workflow; excludes protocol overhead and is not measured Internet transfer |
| Short browser JS-heap sample | 10,726,044 → 12,261,964 bytes | Short before/after sample includes interaction and garbage collection effects; does not establish stable process-family memory |
| Live network transfer/cache size | Unmeasured | Use backend diagnostics and disk usage; separate cold and warm |
| Apple Silicon calibrated navigation/playback/soak | Not yet measured | Native CI functional and launch evidence is separate; no Mac 60-fps or prolonged-memory guarantee |

## Reproducible protocol

Record application commit/package SHA, Electron/Chromium versions, OS/CPU/GPU/RAM, power mode, display scale, window/viewport size, map center/zoom/bearing/pitch, product/source/time/frame count/image resolution, cache state, and network/proxy conditions.

For each scenario:

1. Keep the product and viewport fixed. Separate deterministic fixtures, actual cached observations, and live source downloads.
2. For a cold run, use a new application data directory and record the launching process's monotonic start to an explicit usable-data/render marker. For a warm run, retain and document the same cache.
3. Sample renderer animation frames during a fixed navigation or playback sequence. Report median, p95 and p99 frame intervals, duration, sample count, and missed frames. A `requestAnimationFrame` callback rate alone does not prove the weather texture updated every frame.
4. Record process-family CPU time and memory, including Electron renderer/GPU/utility processes. Sample at a stated interval through at least 30 minutes of looping before claiming stable prolonged memory. Report peak and final memory, cache size and evictions.
5. Capture backend diagnostic counters before/after for actual downloaded bytes, requests, cache hits, failures and stale fallback. Include decoded image/texture resolution and cap policies.
6. Verify the same behavior after offline startup, source interruption, reconnection, sleep/resume and map-layout changes. Frame rate improvements cannot conceal stale data or missing products.
7. Save raw result JSON and an actual screenshot with the run identifier. Inspect the screenshot for readable map registration, labels, legends, synthetic-data markers and timestamps.

Eight-map mode is withheld until profiling demonstrates an acceptable resource budget. Quality reduction should be explicit and preserve source metadata and missing/stale states. Do not infer stronger performance or numerical accuracy from fewer transferred bytes or a visually smooth screenshot.

## Harness interpretation

`TELLER_FIXTURE=1 TELLER_SMOKE_OUTPUT=/absolute/report.json` enables the packaged Electron readiness/screenshot harness. It reports elapsed time from **main-script execution**, resource snapshots, GPU feature status and a renderer-provided `window.__tellerMetrics` object if present. It does not currently supply OS launch time, a long-running leak test, calibrated GPU utilization, or calibrated target-Mac performance measurements. Native release acceptance records separate target launch/runtime facts. A synthetic fixture pass does not establish live-source readiness.

## Native Mac acceptance measurements

[Run40247555425](https://github.com/tylerptt129/rea/actions/runs/40247555425), hosting commit `17f51ffe5d29c310ee65231272dc0d6b12a32a91`, executed on macOS15.7.9 arm64 using the default Electron GPU path and a fresh non-fixture profile. Instrumented launch to usable live data was **12,569 ms**. The source-native probe plus cached repeat took **1,038 ms**; the deliberate interruption/recovery check took **116,202 ms**. These are measured acceptance-stage durations with actual public-source networking, not calibrated cold/warm comparisons or a provider-latency guarantee.

All seven real packaged groups passed; source health remained within startup budgets with no warnings. A separate user-local installation and five copied-app fixture groups also passed. Exact checks and scope are retained in [native evidence](verification/native-mac-40247555425.json). Mac navigation frame-time distributions, a 30-minute playback memory sample, physical sleep/wake and user-display high-DPI performance remain unmeasured. No 60-fps or prolonged-memory claim follows from functional success.
