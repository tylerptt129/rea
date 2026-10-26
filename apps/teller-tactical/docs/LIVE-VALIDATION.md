# Live source acceptance check

## Current status

Native Apple Silicon [run40247555425](https://github.com/tylerptt129/rea/actions/runs/40247555425) passed both this backend live check and the separate actual packaged live workflow on macOS15.7.9 arm64. The packaged app rendered real IEM radar, NASA GIBS visible/IR and NWS data, passed source-native probe missing-value/cache provenance checks, playback, refresh and interruption/recovery. Source health stayed within startup budgets with no warnings. This Linux cloud still rejects weather origins under its current network policy; native CI success does not change that policy. No fixture-mode test or screenshot establishes live data readiness.

After the domain settings are applied, run from the application checkout with the pinned Node toolchain:

```bash
cd /workspace/teller-tactical
npm run test:live
```

The runner writes the full current report to `artifacts/live-smoke.json` and stdout. Exit code 0 means all checks below passed in that run; a failed or blocked run exits 1. The report includes source and frame timestamps, request counts, transferred bytes, cache diagnostics, and elapsed times. It contains no process-environment dump or credential values. The script starts and closes its own loopback gateway on an automatically assigned port and deletes its temporary cache afterward.

## What must pass

1. Gateway health explicitly reports `fixture:false`. The runner passes `fixture:false` directly, even if the calling shell has `TELLER_FIXTURE=1`.
2. A fresh catalog returns a real IEM radar product with at least two distinct, source-verified frame timestamps. An empty catalog, missing verification, a synthetic catalog, or stale fallback fails.
3. For both selected frame times, fetch a 256×256 radar PNG covering Colorado Springs. Web Mercator tile `z=6,x=13,y=24` is calculated from `38.8339,-104.8214`, which is a public city reference point, not an invented property location. Check HTTP status, PNG content type, PNG signature/chunk framing/dimensions, non-stale retrieval, and matching frame-time request metadata. Report content hashes. No precipitation is required for this check: a transparent frame may mean no echo **or missing/blocked coverage** in this provider product. This backend tile check does not decode display colors into dBZ. The separate packaged live check exercises original indexed N0Q archive pixels and worldfile registration; rendered RGB colors are never inverted.
4. NWS point weather returns nonempty forecast periods with valid start/end times, at least one timestamped nearby observation with official source provenance, and successful official alert-retrieval metadata. Zero current alerts can pass. A failed alerts request cannot be mistaken for zero alerts.

The test uses a new temporary data directory and an empty cache on every run. It does not silently succeed from last-known data, replace unavailable sources with fixtures, skip missing observations, or invent observation times. Generic fetch failures are recorded as access blockers without claiming a root cause; source diagnostics and network policy must be checked before deciding whether the cause is DNS, proxy policy, source outage, or TLS configuration.

## Scope limits

This check verifies the local gateway and selected real data operations on its execution host. It does not establish a functioning satellite catalog, exact radar gate values, raw single-site radial velocity, UI playback, sleep/wake recovery, prolonged memory stability, packaged launch, or macOS behavior. Those require separate evidence in the capability matrix and release checklist. A radar success must not change satellite or Mac statuses to verified.

IEM mosaic times are nominal product times; contributing radar sweeps can be older. Tile response observation-time metadata identifies the requested archive-listed time; the WMS PNG itself does not independently embed that timestamp. A successful PNG fetch is not proof of forecast accuracy or sub-minute radar latency. The current runner records frame age without promising a freshness threshold.

## Deterministic tests

```bash
node --test tests/live-smoke.test.mjs
```

These tests make no external weather requests. They prove that explicit live mode overrides an inherited fixture variable, unavailable real sources cannot become synthetic success, stale/unverified manifests fail, PNG framing is checked, the Colorado tile calculation is correct, and a successful empty official alert response is distinguished from failed retrieval.

## Separate packaged Mac acceptance

`npm run release:mac -- --mode developer` performs the native source/fixture/backend/packaged gates; `npm run install:mac` also installs the exact accepted local bundle. Strict startup budgets remain 20 minutes for radar and 70 minutes for the current satellite latency/cadence metadata. Later aging can pass stale-state handling only after a verified fresh baseline, with original timestamps and an explicit visible stale/unavailable label; warnings propagate into release/install reports.

The successful run also installed into a separate user-owned location and passed all five copied-app fixture persistence checks. Real Colorado Springs probe index0 was correctly unavailable, not 0 dBZ or proof of no precipitation. Synthetic numeric fixtures establish other index mappings; no positive live value is claimed. See [recorded native evidence](verification/native-mac-40247555425.json). Notarized distribution, physical sleep/wake and prolonged performance remain separate.
