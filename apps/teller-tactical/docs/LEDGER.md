# Teller Tactical durable task ledger

## Current handoff

**Core live Apple Silicon acceptance and user-local installation passed.** [Native run 40247555425](https://github.com/tylerptt129/rea/actions/runs/40247555425) completed successfully on **macOS 15.7.9 arm64**, hosting commit `17f51ffe5d29c310ee65231272dc0d6b12a32a91`. The accepted canonical runtime source is `632e121bb190cb76175ef182da975753537a11cb`. A final documentation-only update does not change those executable bytes.

Native results: **135 source tests**, **5 packaged fixture groups**, **3 backend real-source groups**, **7 packaged-live groups**, a successful user-local install, and **5 fixture groups against the installed copy**. Real radar, NWS and visible/IR satellite textures, the ASAR native-probe worker, playback, refresh and a **116-second interruption/recovery** were exercised. Source health finished `within-startup-budgets` with `qualityWarnings:[]`; strict startup budgets remain **20 minutes for radar and 70 minutes for satellite**. This is run-specific source evidence, not a guarantee of future availability.

The real N0Q probe selected frame `202610260000` and native index `0`, correctly returning unavailable/null. No nonzero live numerical value was observed. Deterministic and packaged fixture tests verify the quantized mapping separately.

The runner had **zero Developer ID code-signing identities**. Ad-hoc signatures verified successfully; `distributionReady:false`. The recommended user-local source installation needs no paid Apple account and retains normal macOS protections. A notarized downloaded distribution is still outstanding.

## Identity and boundaries

Full scope: [REQUEST.md](REQUEST.md). Canonical application checkout: `/workspace/teller-tactical`, branch `teller-tactical`. With explicit user authorization, the independent app and native workflow are hosted additively in **tylerptt129/rea**, branch **teller-tactical-release**, under **apps/teller-tactical**. REA remains a separate research tool and **main is untouched**. The authorized workflow was resumed and completed; this is not a merge to REA main.

## Delivered core

- Electron desktop app, sandboxed renderer and hardware-accelerated MapLibre maps with bundled worker.
- IEM reflectivity mosaic and source-native indexed N0Q probes; source worldfile registration, nominal mosaic times, 0.5 dBZ quantization and explicit nonquantitative index-zero handling.
- NASA GIBS visible/IR imagery with source timestamp/matrix/projection checks, actual DescribeDomains availability and advertised color-map legends.
- NWS point forecasts, nearby observations, alerts and grids with original units/times, partial failures, complete-window accumulations and descriptive mountain-weather inputs.
- One/two/four maps, linked cameras/times, playback/scrubbing, opacity, themes, property coordinates/elevation, saved cameras, keyboard controls and PNG export.
- Bounded cancellable ingestion, validated cache admission, stable fresh/cache/restart retrieval provenance, stale fallbacks and serialized preference persistence.
- Native developer release validation and safe user-local installation with signature/hash checks and timestamped prior-install backups. See [README](../README.md) for exact install commands and [RELEASE.md](RELEASE.md) for the artifact/checksum.

## Remaining scope

The complete original feature wishlist is not finished. Raw single-site velocity/dual polarization; terrain 3D; arbitrary stacking/docking; multiple model sources/cycles and forecast maps; tracking/nowcasting with held-out validation; full workspace import/export; animation export; and eight-map profiling remain planned or blocked as listed in [capabilities.md](capabilities.md).

Calibrated Mac frame-rate measurements, a 30-minute playback/memory soak, physical sleep/wake and broader user-hardware/high-DPI validation remain outstanding. Native CI establishes the reported workflow on its identified host, not every target or performance target. Signing/notarization requires authorized Developer ID/Apple notarization configuration; none was available on this runner.

WSV3 official-origin research remains blocked and no authorized reference executable was identified. REA performed a real Electron fuse inspection, with [retained evidence](evidence/rea-electron-fuses.json); that is not WSV3 investigation or parity proof.

## Historical failures

Run `40244655567` failed on missing satellite legends and catalog aging after fresh startup. Run `40247212859` exposed a 20 ms fresh/cache retrieval timestamp discrepancy. Provider color maps, explicit aging semantics and committed cache provenance were corrected without loosening freshness budgets; the final run above passed. Earlier managed-cloud HTTP 403 responses and Linux software-GPU fixture results retain their historical scope.

## Resume without starting over

Read AGENTS.md, this ledger, the capability matrix, ADRs and source registry; inspect existing Git statuses. Use existing isolated checkouts, not a new worktree unless requested. Preserve local-only commits and retained artifacts. Keep canonical app and additive CI checkout roles distinct, and leave REA main unchanged. Scope subsequent work to the remaining capabilities or a concrete reported defect; retain original observation/retrieval times and source limitations. Current native evidence is in [VERIFICATION.md](VERIFICATION.md) and the linked successful run; synthetic screenshots remain explicitly synthetic.
