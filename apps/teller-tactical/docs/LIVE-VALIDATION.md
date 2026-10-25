# Live source acceptance check

## Current status

The test runner is implemented. A live run is **pending a meaningful network-policy change**: the initial runtime proxy rejected the required weather hosts with HTTP 403. Do not repeat unchanged requests in a loop. No fixture-mode test or screenshot establishes live data readiness.

After the domain settings are applied, run from the application checkout with the pinned Node toolchain:

```bash
cd /workspace/teller-tactical
npm run test:live
```

The runner writes the full current report to `artifacts/live-smoke.json` and stdout. Exit code 0 means all checks below passed in that run; a failed or blocked run exits 1. The report includes source and frame timestamps, request counts, transferred bytes, cache diagnostics, and elapsed times. It contains no process-environment dump or credential values. The script starts and closes its own loopback gateway on an automatically assigned port and deletes its temporary cache afterward.

## What must pass

1. Gateway health explicitly reports `fixture:false`. The runner passes `fixture:false` directly, even if the calling shell has `TELLER_FIXTURE=1`.
2. A fresh catalog returns a real IEM radar product with at least two distinct, source-verified frame timestamps. An empty catalog, missing verification, a synthetic catalog, or stale fallback fails.
3. For both selected frame times, fetch a 256×256 radar PNG covering Colorado Springs. Web Mercator tile `z=6,x=13,y=24` is calculated from `38.8339,-104.8214`, which is a public city reference point, not an invented property location. Check HTTP status, PNG content type, PNG signature/chunk framing/dimensions, non-stale retrieval, and matching frame-time request metadata. Report content hashes. No precipitation is required for this check: a transparent frame may mean no echo **or missing/blocked coverage** in this provider product. Pixels are not decoded into dBZ and no numerical probe is claimed.
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
