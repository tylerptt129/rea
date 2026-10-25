# Native Apple Silicon release path

The release gate is executable rather than a claim that the current Linux-built archive works on a Mac. Linux cannot launch the Mach-O application, run `codesign`, evaluate Gatekeeper, or perform macOS notarization. No Mac, signing certificate, or notarization credential is exposed by the current tool/runtime configuration. The outbound-identity manifest contains no connections.

A read-only GitHub runner lookup at `api.github.com/repos/tylerptt129/rea/actions/runners` returned `Forbidden`. `GH_TOKEN` is present; that does not establish API or Actions authorization, and no additional token is requested on that evidence alone. A supported authorized API/network route must succeed before any hosted runner can be started. No repository, workflow run, paid runner or public release was created by this investigation.

## Concrete runner choice

The official [actions/runner-images table](https://github.com/actions/runner-images/blob/main/README.md), retrieved during this task, lists **`macos-15` as arm64**; `macos-15-intel` is x64. The workflow uses explicit `macos-15` and checks both `uname` and Node runtime architecture so label changes, Rosetta, or an Intel runner cannot silently pass. `macos-latest` is deliberately not relied upon. Source text need not be copied into the app; the runner facts are independently checked at execution.

`.github/workflows/macos-release.yml` is a **manual-only standalone-app workflow**. Root-repository integration may place the app under a dedicated application directory and set that working directory in an additive branch workflow. Preserve REA's existing default branch and CI. The agent must not infer a new repository or run billed infrastructure without the user's authorized route.

## Exact commands

On an actual Apple Silicon Mac with the pinned Node/npm toolchain and existing Xcode Command Line Tools:

```sh
npm ci --no-audit --no-fund
npm exec install-electron
node scripts/release-mac.mjs --mode developer
```

The developer command:

1. Rejects Linux, Intel/Rosetta and macOS older than13 before packaging.
2. Builds the `.app` on macOS, not merely by cross-packaging it elsewhere.
3. Ad-hoc signs the locally generated developer app with minimal Electron JIT entitlements and verifies its code signature. This is a local developer build; it is **not Developer ID signed, notarized, or claimed to pass downloaded-app Gatekeeper distribution**.
4. Runs source tests with a nonzero count, fixture native workflow, fresh backend live-source checks, and real packaged live-weather acceptance. Mac reports must use normal GPU/security paths, not SwiftShader or sandbox overrides. Fixture and live results remain distinct.
5. Fails on missing data, failed checks, old result files, missing ARM64 code, wrong bundle identity, changed application bytes during testing, or absent acceptance helpers.
6. Creates a `DEVELOPER-NOT-NOTARIZED.zip` only after all required gates pass, using macOS `ditto` and CRC validation. It retains an exact SHA256 and the tested executable/ASAR digests.

For an already built native bundle:

```sh
node scripts/verify-mac.mjs \
  --app '/absolute/path/Teller Tactical.app' \
  --mode developer \
  --report '/absolute/path/mac-acceptance.json'
```

Neither command can honestly pass on this Linux host. Preparing and testing their rejection/policy logic does not substitute for running them on macOS.

## Distribution with normal macOS protections

A ready-to-download distribution requires an authorized release Mac with an already installed **Developer ID Application** certificate/private key and an existing `notarytool` keychain profile. The scripts select these existing bindings by non-secret names; they do not export keys, copy passwords into files, or ask for secret values in chat. No Apple Developer subscription is purchased.

Select the existing identity/profile in that release environment, then run:

```sh
node scripts/release-mac.mjs --mode distribution
```

Required selector names:

- `TELLER_MAC_SIGN_IDENTITY`: installed `Developer ID Application: ...` identity.
- `TELLER_NOTARY_PROFILE`: existing `notarytool` keychain profile.
- `TELLER_MAC_KEYCHAIN`: optional existing keychain selector.

Distribution mode verifies the Developer ID chain, hardened runtime, secure timestamp and team identifier, submits the signed app to Apple, requires an `Accepted` result, staples the ticket, validates the staple, and requires Gatekeeper's `Notarized Developer ID` acceptance. It runs the same native/live tests against the actual signed package, then creates a separately named `SIGNED-NOTARIZED.zip`. Failed or missing trust/acceptance cannot be converted into a successful distribution artifact. No quarantine removal, Gatekeeper disabling or security override is included.

The manual workflow allows distribution only on an explicitly authorized self-hosted Apple Silicon Mac with that keychain setup. The ordinary hosted job is a developer-validation route and cannot manufacture signing credentials. GitHub artifacts are evidence/package retention, not an automatically published public release.

## Reports and external prerequisites

Reports are saved under `release/macos-verification/` and `release/macos-release.json`. Artifact collection runs on failure so a failed live source is visible rather than silently skipped. The original app/personal profile is never the acceptance test profile.

Still required outside this Linux machine:

1. An authorized actual macOS ARM64 execution route: the user-approved GitHub repository/runner or an attached/remote Mac.
2. Working public-source network access on the runner and current real source responses. The cloud's saved domain draft has not established that access.
3. For downloaded distribution only, the authorized preconfigured Developer ID/notary keychain. Local developer verification does not require purchasing or inventing this identity.
4. Physical target Mac interaction/high-DPI/sleep and sustained performance verification; CI/virtual-Mac success alone does not establish the user's personal GPU and display behavior.

The full requested application capability matrix remains authoritative. A native core gate does not declare unfinished advanced weather capabilities complete.
