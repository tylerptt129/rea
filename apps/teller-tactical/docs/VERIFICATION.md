# Verification record

## Successful native Apple Silicon acceptance

[Run 40247555425](https://github.com/tylerptt129/rea/actions/runs/40247555425) completed **SUCCESS** on **macOS 15.7.9 arm64**, hosting commit `17f51ffe5d29c310ee65231272dc0d6b12a32a91`. Canonical runtime source: `632e121bb190cb76175ef182da975753537a11cb`. Source is hosted additively in `tylerptt129/rea`, branch `teller-tactical-release`, under `apps/teller-tactical`; REA main remains unchanged.

| Executed check | Result |
| --- | --- |
| Source tests on native Mac | 135 passed |
| Packaged native fixture workflow | 5 groups passed |
| Backend real-source checks | 3 groups passed |
| Packaged live workflow | 7 groups passed |
| User-local installation | Passed; copied signature and executable/ASAR fingerprints verified |
| Installed application's native fixture workflow | 5 groups passed |

The packaged-live workflow exercised the normal hardware GPU/security path, actual recent IEM radar, NWS data and NASA GIBS visible/IR textures/legends, the source-native ASAR probe worker, playback, refresh and **116 seconds of interruption/recovery**. Final source health was **`within-startup-budgets`**, **`qualityWarnings:[]`**. Startup budgets remained **20 minutes for radar / 70 minutes for satellite**. Subsequent aging retains original times and must become visibly stale/unavailable; source health describes this run, not perpetual freshness.

### Numerical-probe evidence boundary

The actual N0Q frame was `202610260000`; the native source index was `0`, yielding **unavailable/null** with explicit missing/no-quantitative-value semantics. **No nonzero live numerical value was observed.** The live run establishes real archive/worldfile access, ASAR worker operation and the index-zero result. Deterministic and packaged fixture tests separately verify quantized mapping (including indices 65 → 0 dBZ and 255 → 95 dBZ), coordinate registration and cache provenance. Rendered RGB colors are never inverted into measurements.

### Package and installation trust

The native runner reported **zero Developer ID code-signing identities**. Ad-hoc bundle signatures passed strict verification, including after installation. **`distributionReady:false`**: no Developer ID notarization, stapling or Gatekeeper distribution acceptance is claimed. The user-local source route needs no paid Apple account and preserves security protections.

Validated [developer artifact](https://github.com/tylerptt129/rea/actions/runs/40247555425/artifacts/12619009605), inner archive:

```text
Teller-Tactical-0.1.0-mac-arm64-DEVELOPER-NOT-NOTARIZED.zip
SHA-256: 8663907c043763a5b398a79d434b25e4a7ac85b0fd3746337377b0cbca1925d4
```

## Local and earlier retained evidence

Local production build and **19/19 browser fixture acceptance groups** passed (browser completion `2026-10-25T23:52:06.336Z`). The final native source suite above ran 135 tests. Deterministic fixtures, browser interactions, native fixtures and real-source checks have separate scopes; none is relabeled as another.

Earlier Linux package checks established normal sandbox launch, fixture pixels, preference relaunch and quit/window-close flush using software rendering. Archived reports include `verification/packaged-linux.json`, `verification/packaged-linux-harness.json` and `verification/packaged-asar-probe-linux.json`. Earlier unit/browser outputs remain revision-scoped. REA inspected the actual downloaded Electron ELF fuses; retained artifact/digest Evidence proves a REA operation, not WSV3 investigation.

Run `40244655567` failed on satellite legend HTTP 404 and post-startup aging. Run `40247212859` failed a strict repeated-probe retrieval-time comparison, revealing a 20 ms fresh/cache timestamp discrepancy. The final run passed after source color-map handling, explicit aging reports and stable committed cache provenance were corrected. Startup freshness budgets and the provenance assertion were retained. Initial managed-cloud HTTP 403 failures do not describe the final Mac's actual source access.

## Remaining verification

Calibrated Mac frame-rate/CPU/memory benchmarks, a 30-minute playback soak, physical sleep/wake, broader user-hardware/high-DPI checks, comparative accuracy/performance and a nonzero live quantitative probe remain unverified. Raw single-site velocity/dual polarization, terrain 3D, model maps and validated tracking/nowcasting are not delivered. WSV3 observable/binary behavior remains unknown where source access or an authorized executable is absent. Notarized distribution remains outstanding.

## Reproduce

On Apple Silicon macOS 13+ with Node.js 24.22.1+ and pinned npm dependencies:

```sh
npm ci
npm exec install-electron
npm run install:mac
# Or rerun native release gates without installing:
npm run release:mac -- --mode developer
# Reuse only an exact already accepted bundle:
npm run install:mac -- --from-verified --no-open
```

The installer emits `release/macos-verification/installed-local.json`. Native release reports/screenshots remain in `release/macos-verification/`, with `release/macos-release.json` as the release summary. The final handoff's documentation-only update changes no executable code and does not require a redundant native run for those same bytes.
