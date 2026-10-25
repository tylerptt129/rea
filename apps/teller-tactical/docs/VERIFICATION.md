# Verification record

## Native Apple Silicon progress

The user authorized and resumed a native `macos-15` GitHub Actions workflow on the additive `teller-tactical-release` branch of `tylerptt129/rea`, with the independent application in `apps/teller-tactical`. REA main remains unchanged.

[Run 40244655567](https://github.com/tylerptt129/rea/actions/runs/40244655567) **failed overall**. Its executed native checks established:

- The packaged application launched on Darwin/arm64 using the target hardware GPU path.
- Actual radar, visible/infrared satellite textures and NWS data rendered after a strictly fresh startup.
- Radar frame selection/playback changed real accepted source-frame identities.

The same run exposed missing satellite legends returning HTTP 404 and catalog aging after the fresh startup. Passing earlier checks does not turn this into a passing release gate. The native runner reported **zero valid code-signing identities**; the current route can produce an ad-hoc developer candidate, not a Developer ID/notarized download.

## Current source changes awaiting native revalidation

- Satellite discovery now accepts provider-advertised GIBS color-map metadata and renders source labels/colors/units when a supported image legend is absent. This addresses the missing-legend integration path in source; live Mac legend output still needs verification.
- IEM N0Q probing now reads original indexed PNG values with the archive worldfile, using a bounded worker rather than display-color inversion. Samples retain source/cell/time provenance, 0.5 dBZ quantization and composite limitations; index zero remains nonquantitative. This new path has not passed live Mac acceptance.
- Native acceptance retains a verified-fresh startup baseline, then checks that later source aging stays visible and produces explicit quality warnings. It preserves observation times and startup freshness budgets. The integrated behavior requires a fresh native run.

## Current local integration validation

The integrated source passed the following local checks:

- `npm test`: **134 passed**, zero failed/skipped.
- `npm run build`: production build passed.
- `npm run test:ui`: **19/19 browser fixture acceptance groups passed**, completed **2026-10-25T23:52:06.336Z**.

These are local integration results, including deterministic contracts and explicitly synthetic browser fixtures. They do not establish a passing current-source live Mac gate, native Mac probing, or notarized distribution. Keep older archived outputs below separate from this run.

## Earlier retained validation

- Pinned Node 24.22.1/npm 11.16.0 installation, frozen lockfile reinstall and production Vite build including the MapLibre worker asset were exercised.
- Deterministic contracts and browser fixture acceptance passed at earlier revisions. Archived outputs: `verification/unit-tests.txt` and `verification/ui-smoke.json`. Keep their revision/time scope separate from subsequent changes.
- REA `inspect-electron-fuses` inspected the actual downloaded Electron ELF; retained Evidence includes artifact digest and observed fuse states. This is a real REA operation, not WSV3 investigation.
- Linux and Apple Silicon packages were generated on Linux. Native Linux fixture checks exercised real pixels, sandboxed launch, preferences, relaunch and quit/window-close flush; records are in `verification/packaged-linux.json` and `verification/packaged-linux-harness.json`. Software rendering and its limits are documented in RELEASE.md/PERFORMANCE.md.

The initial managed cloud proxy rejected required public destinations with HTTP 403. That historical limitation does not describe the native CI source access demonstrated above. Native run failures must be diagnosed from that run's actual responses and stage reports.

## Not established

A complete successful live Mac release gate for the current source; live Mac native-index probing and color-map legends; prolonged playback stability; physical sleep/wake; user-hardware high-DPI/GPU performance; comparative accuracy/performance; Developer ID signing, notarization, stapling and Gatekeeper distribution acceptance; WSV3 observable/binary behavior; raw single-site velocity/dual polarization; validated tracking/nowcasting.

## Commands

```sh
npm ci
npm exec install-electron
npm run build
npm test
npm run test:ui
npm run test:live
npm run package:mac
npm run package:linux
# Native Apple Silicon only; builds, ad-hoc signs, and runs required acceptance:
npm run release:mac -- --mode developer
```

Use current-instance tool activation from README.md/RELEASE.md on this managed Linux host. Fixtures are explicit. Live runners select `fixture:false` and fresh profiles/caches; source failures, quality warnings, skipped/unrun stages and passed assertions remain distinct. An ad-hoc developer result can never establish notarized distribution.
