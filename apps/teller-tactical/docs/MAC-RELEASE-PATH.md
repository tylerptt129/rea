# Native Apple Silicon release path

Native Apple Silicon release, real packaged weather, user-local installation and copied-app relaunch all passed in [run40247555425](https://github.com/tylerptt129/rea/actions/runs/40247555425), on macOS15.7.9 arm64. The tested hosting commit is `17f51ffe5d29c310ee65231272dc0d6b12a32a91`; [recorded evidence](verification/native-mac-40247555425.json) retains the source commit, checks and artifact digest. Source health stayed within the startup budgets with no quality warnings.

The Linux cloud cannot run Mac tools itself. The user authorized native GitHub Actions in the verified public fork `tylerptt129/rea`, on the additive `teller-tactical-release` branch. REA main remains untouched. Earlier `actions/runners` API lookup rejection was endpoint-specific; the existing scoped authentication successfully enabled, dispatched and inspected this workflow. No additional token or paid subscription was needed.

The runner had zero valid distribution signing identities. The passing artifact is ad-hoc developer signed and not notarized. A local source build/install does not require a paid Apple account; a normal notarized downloaded distribution still requires existing Developer ID authority.

## Concrete runner choice

The official [actions/runner-images table](https://github.com/actions/runner-images/blob/main/README.md), retrieved during this task, lists **`macos-15` as arm64**; `macos-15-intel` is x64. The workflow uses explicit `macos-15` and checks both `uname` and Node runtime architecture so label changes, Rosetta, or an Intel runner cannot silently pass. `macos-latest` is deliberately not relied upon. Source text need not be copied into the app; the runner facts are independently checked at execution.

`.github/workflows/macos-release.yml` is a **manual-only standalone-app workflow**. The active root-repository integration is `.github/workflows/teller-macos-release.yml`, with `apps/teller-tactical` as its working directory on the additive release branch. Preserve REA's existing default branch and CI. The agent must not infer a new repository or run billed infrastructure without the user's authorized route.

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

These commands passed on the native Mac runner. They correctly reject this Linux host. `npm run install:mac` additionally stages and verifies the accepted bundle under `~/Applications`, preserves an existing app backup, and opens it with normal macOS protections.

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

Execution and remaining prerequisites:

1. Native execution: fulfilled by the user-approved Apple Silicon GitHub runner and recorded successful run.
2. Real source access: fulfilled on the Mac runner. The Linux cloud's network draft remains separate and must be applied through environment settings before cloud-origin live checks can work.
3. For downloaded distribution only, the authorized preconfigured Developer ID/notary keychain. Local developer verification does not require purchasing or inventing this identity.
4. Physical target Mac interaction/high-DPI/sleep and sustained performance verification; CI/virtual-Mac success alone does not establish the user's personal GPU and display behavior.

The full requested application capability matrix remains authoritative. A native core gate does not declare unfinished advanced weather capabilities complete.
