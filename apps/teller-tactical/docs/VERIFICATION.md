# Verification record

## Executed

- Pinned Node24.22.1/npm11.16.0 dependency installation; frozen lockfile reinstall; production Vite build including MapLibre6 worker asset.
- `npm test`:61 deterministic tests passed (zero failed/skipped), including real tile-readiness and preference-write ordering regressions. Full current output: verification/unit-tests.txt.
- `npm run test:ui`: real sandboxed Chromium fixture interactions, rendered texture/time changes, multi-map synchronization, themes, persistence, interruption and offline startup. All18 control/failure groups passed again after the final contrast/save-order fixes; the current run is recorded in verification/ui-smoke.json.
- REA `inspect-electron-fuses` inspected the actual downloaded Electron ELF; Evidence includes artifact digest and observed fuse states. This proves a real REA analysis operation, not WSV3 investigation.
- Unsigned Linux and Apple Silicon application packages generated. Five native Linux fixture groups passed, including real pixels, sandbox, relaunch and both immediate save/close paths; verification/packaged-linux.json records the result. Exact software-rendering flags and limits are in RELEASE.md/PERFORMANCE.md.

## Not established

Actual live radar/satellite/NWS operation, actual source legend output/terms, WSV3 observable behavior, raw radar numerical probing, macOS launch, macOS high-DPI/GPU performance, physical sleep/wake,30-minute playback stability, comparative accuracy/performance, and signed/notarized distribution.

The environment proxy rejected required public destinations with403. Its running spec revision remains1 with no custom allowed hosts; saving the network draft did not apply it. Unchanged remote failures were not repeatedly retried or bypassed.

## Commands

```sh
npm ci
npm exec install-electron
npm run build
npm test
npm run test:ui
npm run test:live  # meaningful live acceptance; cannot pass while policy blocks feeds
npm run package:mac
npm run package:linux
```

Use the current-instance tool activation described in README.md/RELEASE.md when running in this cloud workspace. Fixtures are explicit; the live runner always selects fixture:false and a fresh cache. Source/scenario failure evidence is kept separate from passed assertions.
