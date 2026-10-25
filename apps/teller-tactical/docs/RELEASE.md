# Release and first launch

Primary target: Apple Silicon macOS (`darwin-arm64`). The development/automation host is Linux x86_64. A generated macOS `.app` is **unverified on its target OS until it has actually been launched and tested on macOS**. Nothing in a successful Linux test establishes Apple Silicon performance or Gatekeeper acceptance.

## Build from source

Use Node.js 24.22.1 or a compatible newer version and npm. From the independent Teller Tactical directory:

```sh
npm ci
npm exec install-electron
npm test
npm run build
npm start
```

Electron 45 installs its runtime with the explicit `install-electron` command; `npm ci` alone installs the package metadata and CLI. The installer validates the official artifact checksum supplied in the pinned package. `npm start` opens the native desktop window and starts its local weather gateway automatically; no separate server launch or API credential is needed for the configured public products. Build before the first desktop launch. REA remains separate in the sibling checkout.

In the managed cloud host, first source `/workspace/.onboarding/rea/activate.sh`, then use `ELECTRON_GET_USE_PROXY=1 ELECTRON_CACHE=/workspace/.cache/electron electron_config_cache=/workspace/.cache/electron npm exec install-electron` to preserve the inherited proxy and use writable cache storage. Do not disable TLS or checksum verification.

For a browser-only development session, run `npm run dev` and use the loopback URL printed by the command. That development path is distinct from testing a packaged desktop application.

## Package

```sh
npm run package:mac
```

Expected macOS bundle:

```text
release/Teller Tactical-darwin-arm64/Teller Tactical.app
```

The existing package command uses pinned Electron and Electron Packager dependencies. It can assemble an Apple Silicon bundle on Linux, but macOS signing can only be performed on macOS. Retain package-manager integrity and Electron artifact verification. A failed download or unsupported signing tool is a blocker, not a reason to disable verification.

Initial cross-packaging succeeded on the Linux host for both `linux-x64` and `darwin-arm64`. The Mac main executable was identified as a 64-bit arm64 Mach-O; its bundle identifier is `tools.tellertactical.desktop`, version `0.1.0`, and Electron's minimum macOS version is `13.0`. File-format inspection is not launch verification. Electron Packager warned that ASAR integrity digest enforcement cannot be embedded when packaging macOS on Linux because `codesign` is unavailable to restore the framework signature. Rebuild the final package on macOS for integrity enforcement and any signing/notarization. Packages must be rebuilt after subsequent source fixes; these initial paths do not establish a final release.

On macOS, open the bundle normally from Finder or run:

```sh
open 'release/Teller Tactical-darwin-arm64/Teller Tactical.app'
```

The bundle is not claimed to be signed or notarized. Developer ID signing and notarization require an authorized Apple Developer identity and a macOS release environment; neither is available in this cloud host. Do not disable Gatekeeper, remove quarantine attributes, or turn off security protections to run a downloaded bundle. A local source build on the user's Mac is the appropriate development route while a signed distribution is unavailable.

Linux test packaging is separate:

```sh
npm run package:linux
'release/Teller Tactical-linux-x64/Teller Tactical'
```

The Linux package does not substitute for a verified Mac release. An application folder alone is not a signed installer or auto-update channel.

## First-launch workflow

1. Start the application and keep fixture/demo mode off for real-weather use.
2. The initial workspace is Colorado. A regional map center is not a property location. Enter exact property coordinates when using point forecasts, and edit the initial 9,200-foot elevation to the actual value.
3. Select an available product and inspect its source, product identity, observed/valid time, and age. Wait for available frames to finish loading before assessing animation.
4. Use the timeline to select a frame and start playback. Missing or stale products must remain visibly identified; the interface cannot turn a blocked feed into live data.
5. Refresh, relaunch, and verify that preferences remain. Review data-source limitations in [data-sources.md](data-sources.md).

The current managed cloud proxy blocks required live weather/reference destinations. Saving domain requirements in an environment draft does not apply access or validate current feed schemas. Until actual live fetch, render, animation, and refresh checks pass, do not label this release ready for live use.

## Packaged-application fixture smoke test

The Electron entrypoint supports a bounded, explicitly synthetic acceptance run:

```sh
TELLER_FIXTURE=1 \
TELLER_TEST_USER_DATA="$(mktemp -d)" \
TELLER_SMOKE_OUTPUT="$(pwd)/test-results/packaged-electron.json" \
  'release/Teller Tactical-linux-x64/Teller Tactical'
```

On macOS, invoke the executable inside `Teller Tactical.app/Contents/MacOS/Teller Tactical` with the same environment variables. The output and test-profile paths must be absolute. `TELLER_TEST_USER_DATA` is accepted only with `TELLER_FIXTURE=1`; it overrides Electron's user-data directory before startup so tests on macOS also avoid real preferences. `XDG_CONFIG_HOME` alone does not isolate a Mac application. Fixture mode must be conspicuous in the UI.

The harness waits up to 20 seconds for `window.__tellerReady === true` or `{ready:true,...}`, a nonzero map canvas, current displayed weather frames for each map, a non-placeholder visible timeline label, and no pending loading labels. It requires 600 ms of stable frame identities and waits for two compositor animation frames before capture. The renderer must set the marker only after actual fixture-data and map/frame render readiness; the additional current-state checks guard against a marker left true during subsequent loading. Merely loading the HTML document is insufficient. The harness captures an actual native-window PNG, writes JSON containing observed readiness, console errors, application/platform versions, GPU feature status, and process resource snapshots, then quits through normal gateway cleanup. Failures produce a report and nonzero process status. `mainScriptToReadyMs` excludes OS process creation and is not a cold-start measurement.

Some isolated Linux containers prohibit Chromium's required user namespaces and therefore cannot launch its sandbox. Do not change application source to disable the renderer sandbox. Record a host limitation separately if a container-specific launcher is used; it is not evidence of the normal macOS security model.

For this cloud host, Xvfb was installed without privileged system mutation by downloading its signature-verified Debian package and extracting it under `/workspace/.tools/xvfb/root`. Its `xvfb-run` wrapper uses normal X authorization and disables TCP listening. Add `/workspace/.tools/xvfb/root/usr/bin` to `PATH` before `xvfb-run -a`. Starting the local X11 socket requires the supported command-sandbox escalation; the ordinary command sandbox rejected its bind. `XDG_CONFIG_HOME` should point to a writable test directory under `/workspace` for this restricted cloud account.

The repeatable native workflow test uses an isolated profile and three actual packaged application processes:

```sh
node scripts/packaged-smoke.mjs \
  'release/Teller Tactical-linux-x64/Teller Tactical'
```

Use `xvfb-run -a` before `node` on a headless Linux host. Pass the executable inside the `.app` bundle for a future Mac run. The helper explicitly sets `chromiumSandbox:true`; Playwright's Linux Electron default would otherwise add a sandbox-disabling flag. Its software ANGLE flags are test-only. It verifies actual raster/frame changes, UI property/theme persistence, immediate pending-write flush on app quit, and pending-write flush on actual `BrowserWindow.close()`, then checks restoration in a fresh native process. The final Linux run passed **5/5 groups** with zero JavaScript console/page errors. Inspect `test-results/packaged-workflow.json`, `packaged-workflow-first.png`, and `packaged-workflow-restored.png`; both final native screenshots were inspected for visible weather pixels, timestamps, property state and readable light/dark contrast.

The built-in non-debugging screenshot/autoquit harness also passed on the final package: `test-results/packaged-final.json` and `.png`, with a real displayed synthetic frame and a 3,410 ms main-script-to-ready measurement. Initial failed/optimistic captures remain separately retained; they are not passing release evidence.

## Security and reliability boundary

- The renderer is sandboxed, context isolated, and has no Node integration. Its preload exposes only platform/version information and resume notifications.
- The renderer's network requests are confined to the local gateway; the backend owns approved remote weather requests, inherited proxy/CA trust, cache, and cancellation.
- Browser navigation and new windows are denied except explicitly recognized official HTTPS links opened in the system browser. Permissions and embedded webviews are denied.
- Only loopback gateway URLs are accepted by the desktop entrypoint. A fresh gateway starts for each application process and closes on quit.
- Preferences live in `userData/weather-store/settings.json`; weather bytes use its `cache` subdirectory. This avoids Chromium's own `Cache` directory and case-insensitive macOS path collisions. Native window close and app quit await the renderer's serialized preference flush before destroying it or stopping the gateway. A save error keeps the application open and reports the failure.
- macOS activates/reopens the window normally and permits standard app/edit/view/window menus. Sleep resume notifies the renderer to refresh; the renderer must implement that refresh behavior.

## Release checklist

Do not check these boxes without current-run evidence. Update the capability matrix and task ledger with exact test results and paths.

- [x] Locked installation and build pass.
- [x] Deterministic numerical and failure/recovery tests pass with nonzero test count; see task ledger for exact suite evidence.
- [x] Real packaged Linux fixture application launches and screenshots are inspected; 5 native workflow groups passed.
- [ ] Every visible control has a tested implementation; unfinished controls are omitted or honestly identified.
- [ ] Actual authorized live sources return expected metadata and georeferenced imagery.
- [ ] Live application loads, animates and refreshes real data successfully.
- [ ] Offline startup, stale cache, interrupted download and reconnection behavior pass.
- [x] Settings survive packaged relaunch, app-quit flush, and native window-close flush in isolated Linux fixture tests.
- [ ] Apple Silicon `.app` launches and passes core acceptance on macOS.
- [ ] Performance measurements are recorded on identified target hardware.
- [ ] Optional derived tracking/nowcast capabilities have held-out validation before operational claims.
- [ ] Signing/notarization and distribution verification are completed before claiming distribution readiness.

See [PERFORMANCE.md](PERFORMANCE.md) for measurement scope and missing evidence.

Initial packaged Linux test evidence exists at `test-results/packaged-electron.json` and `.png`. The normal Electron sandbox launched under Xvfb, but readiness failed because WebGL2 was blocklisted on this host, and the initial renderer build was subsequently found to need a separate MapLibre worker asset. This failed attempt is retained as a diagnosis, not a passing acceptance result. The final fixture package was retested successfully after fixes using explicit software rendering, preserving its sandbox.
