import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_IDENTIFIER, requireMacHost, machoArchitectures, requireBundleInfo, signatureSummary, requireGatekeeper, requireAcceptance, parseMacArguments, diagnosticText, commandDiagnostic, acceptanceDiagnostic, checkAcceptanceReport, run } from '../scripts/verify-mac.mjs';
import { artifactName, parseReleaseArguments, requireAcceptedNotarization, requireReleaseConfiguration } from '../scripts/release-mac.mjs';

const host = { platform: 'darwin', arch: 'arm64', version: '15.6.1' };
const bundle = { CFBundleIdentifier: APP_IDENTIFIER, CFBundleExecutable: 'Teller Tactical', CFBundleShortVersionString: '0.1.0', LSMinimumSystemVersion: '13.0' };
const signature = 'CodeDirectory v=20500 size=1024 flags=0x10000(runtime) hashes=42\nAuthority=Developer ID Application: Test Developer (ABCD123456)\nAuthority=Developer ID Certification Authority\nTimestamp=Oct 25, 2026\nTeamIdentifier=ABCD123456\n';
const current = Date.parse('2026-10-25T15:00:00Z');
const evidence = { status: 'passed', startedAt: new Date(current).toISOString(), host, checks: [{ name: 'actual-render', status: 'passed' }], launchFlags: ['--remote-debugging-address=127.0.0.1'], consoleErrors: [], pageErrors: [], fixture: false };

test('native target gate distinguishes Linux cross-build, Rosetta/Intel and unsupported macOS from Apple Silicon', () => {
  assert.throws(() => requireMacHost({ platform: 'linux', arch: 'arm64', version: '15.6' }), /Linux cross-build/);
  assert.throws(() => requireMacHost({ platform: 'darwin', arch: 'x64', version: '15.6' }), /translated x64/);
  assert.throws(() => requireMacHost({ platform: 'darwin', arch: 'arm64', version: '12.7' }), /13.0/);
  assert.throws(() => requireMacHost({ ...host, version: '15beta' }), /numeric/);
  assert.deepEqual(requireMacHost(host), host);
});

test('Mach-O inspection proves arm64 code rather than trusting archive names or package metadata', () => {
  const arm = Buffer.alloc(32); arm.writeUInt32LE(0xfeedfacf); arm.writeUInt32LE(0x0100000c, 4);
  const intel = Buffer.from(arm); intel.writeUInt32LE(0x01000007, 4);
  assert.deepEqual(machoArchitectures(arm), ['arm64']);
  assert.throws(() => machoArchitectures(arm.subarray(0, 8)), /truncated/);
  assert.deepEqual(machoArchitectures(intel), ['x64']);
  assert.throws(() => requireBundleInfo(bundle, host, machoArchitectures(intel)), /arm64 code/);
  const fat = Buffer.alloc(48); fat.writeUInt32BE(0xcafebabe); fat.writeUInt32BE(2, 4); fat.writeUInt32BE(0x01000007, 8); fat.writeUInt32BE(0x0100000c, 28);
  assert.deepEqual(machoArchitectures(fat), ['x64', 'arm64']);
  assert.throws(() => machoArchitectures(fat.subarray(0, 20)), /truncated/);
  assert.throws(() => machoArchitectures(Buffer.from('not a native executable')), /Mach-O/);
});

test('bundle validation preserves actual identity/version/minimum-host facts', () => {
  assert.equal(requireBundleInfo(bundle, host, ['arm64']).identifier, APP_IDENTIFIER);
  assert.throws(() => requireBundleInfo({ ...bundle, CFBundleIdentifier: 'other.app' }, host, ['arm64']), /identifier/);
  assert.throws(() => requireBundleInfo({ ...bundle, LSMinimumSystemVersion: '26.0' }, host, ['arm64']), /older/);
  assert.throws(() => requireBundleInfo({ ...bundle, CFBundleShortVersionString: undefined }, host, ['arm64']), /version/);
});

test('distribution cannot relabel ad-hoc or untimestamped unhardened code as a trusted release', () => {
  assert.equal(signatureSummary('Signature=adhoc\nCodeDirectory v=20500 flags=0x2(adhoc)', 'developer').kind, 'adhoc-developer');
  assert.throws(() => signatureSummary('Signature=adhoc\nCodeDirectory v=20500 flags=0x2(adhoc)', 'distribution'), /Distribution requires/);
  assert.equal(signatureSummary(signature, 'distribution').hardenedRuntime, true);
  assert.throws(() => signatureSummary(signature.replace(/^Timestamp=.*\n/m, ''), 'distribution'), /secure timestamp/);
  assert.throws(() => signatureSummary(signature.replace('0x10000(runtime)', '0x0(none)'), 'distribution'), /hardened runtime/);
});

test('Gatekeeper acceptance and Apple notarization require positive current results', () => {
  assert.deepEqual(requireGatekeeper({ code: 0, output: '/tmp/Teller Tactical.app: accepted\nsource=Notarized Developer ID\n' }), { accepted: true, source: 'Notarized Developer ID' });
  assert.throws(() => requireGatekeeper({ code: 1, output: '/tmp/app: rejected\nsource=Notarized Developer ID' }), /did not accept/);
  assert.throws(() => requireGatekeeper({ code: 0, output: '/tmp/app: accepted\nsource=Developer ID' }), /did not accept/);
  const accepted = { status: 'Accepted', id: '12345678-abcd-1234-abcd-123456789abc' };
  assert.deepEqual(requireAcceptedNotarization(accepted), accepted);
  assert.throws(() => requireAcceptedNotarization({ ...accepted, status: 'Invalid' }), /did not accept/);
  assert.throws(() => requireAcceptedNotarization({ ...accepted, id: '-'.repeat(36) }), /did not accept/);
});

test('release mode uses local keychain selectors and never guesses or invents signing credentials', () => {
  assert.equal(requireReleaseConfiguration('developer', {}).identity, '-');
  assert.throws(() => requireReleaseConfiguration('distribution', {}), /installed Developer ID/);
  assert.throws(() => requireReleaseConfiguration('distribution', { TELLER_MAC_SIGN_IDENTITY: 'Developer ID Application: Test (TEAM)' }), /keychain profile/);
  const configured = requireReleaseConfiguration('distribution', { TELLER_MAC_SIGN_IDENTITY: 'Developer ID Application: Test (TEAM)', TELLER_NOTARY_PROFILE: 'teller-notary', TELLER_MAC_KEYCHAIN: '' });
  assert.equal(configured.notaryProfile, 'teller-notary');
  assert.equal(configured.keychain, undefined);
  assert.throws(() => requireReleaseConfiguration('distribution', { TELLER_MAC_SIGN_IDENTITY: '-', TELLER_NOTARY_PROFILE: 'a' }), /Developer ID/);
});

test('current real Mac acceptance rejects stale reports, fixtures, Linux, software overrides and zero checks', () => {
  assert.equal(requireAcceptance(evidence, { kind: 'packaged-live', startedAt: current }).passed, true);
  assert.throws(() => requireAcceptance({ ...evidence, startedAt: new Date(current - 60_000).toISOString() }, { kind: 'packaged-live', startedAt: current }), /current validation run/);
  assert.throws(() => requireAcceptance({ ...evidence, fixture: true }, { kind: 'packaged-live', startedAt: current }), /synthetic/);
  assert.throws(() => requireAcceptance({ ...evidence, checks: [] }, { kind: 'packaged-live', startedAt: current }), /meaningful/);
  assert.throws(() => requireAcceptance({ ...evidence, host: { platform: 'linux', arch: 'x64' } }, { kind: 'packaged-live', startedAt: current }), /Apple Silicon/);
  assert.throws(() => requireAcceptance({ ...evidence, launchFlags: ['--use-angle=swiftshader'] }, { kind: 'packaged-live', startedAt: current }), /normal GPU/);
  assert.throws(() => requireAcceptance({ ...evidence, launchFlags: ['--no-sandbox'] }, { kind: 'packaged-live', startedAt: current }), /normal GPU/);
  assert.throws(() => requireAcceptance({ ...evidence, consoleErrors: undefined }, { kind: 'packaged-live', startedAt: current }), /omitted/);
  assert.throws(() => requireAcceptance({ ...evidence, pageErrors: ['uncaught'] }, { kind: 'packaged-live', startedAt: current }), /JavaScript errors/);
  assert.throws(() => requireAcceptance({ ...evidence, fixture: true }, { kind: 'backend-live', startedAt: current }), /synthetic/);
});

test('release commands separate developer archives and require explicit distribution intent', () => {
  assert.deepEqual(parseReleaseArguments([]), { mode: 'developer' });
  assert.deepEqual(parseReleaseArguments(['--mode', 'distribution']), { mode: 'distribution' });
  assert.throws(() => parseReleaseArguments(['--disable-gatekeeper']), /Usage/);
  assert.throws(() => artifactName('../0.1.0', 'developer'), /safe/);
  assert.match(artifactName('0.1.0', 'developer'), /DEVELOPER-NOT-NOTARIZED/);
  assert.match(artifactName('0.1.0', 'distribution'), /SIGNED-NOTARIZED/);
  assert.deepEqual(parseMacArguments(['--app', '/tmp/Test.app', '--mode', 'developer']), { app: '/tmp/Test.app', mode: 'developer' });
  assert.throws(() => parseMacArguments(['--skip-live']), /Usage/);
});

test('Mac workflow requires manual dispatch, real ARM64 and fail-closed gates before artifact retention', async () => {
  const workflow = await readFile(new URL('../.github/workflows/macos-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*(?:push|pull_request):/m);
  assert.match(workflow, /macos-15/);
  assert.match(workflow, /test "\$\(uname -m\)" = arm64/);
  assert.match(workflow, /npm ci --no-audit --no-fund/);
  assert.match(workflow, /node scripts\/release-mac\.mjs/);
  assert.match(workflow, /if: success\(\)/);
  assert.doesNotMatch(workflow, /secrets\.[A-Z_]*(?:PASSWORD|TOKEN|CERTIFICATE)/);
});


test('failure diagnostics retain bounded command tails while removing terminal/control injection', () => {
  const hostile = '\u001b[31mGPU failed\u001b[0m\r\n::error::forged\u0000\u001b]0;window-title\u0007 %0Aend';
  const summary = diagnosticText(hostile);
  assert.match(summary, /GPU failed/);
  assert.doesNotMatch(summary, /[\u0000-\u001f\u007f]/);
  assert.doesNotMatch(summary, /window-title/);
  const rootEscaped = summary.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  assert.match(rootEscaped, /%250Aend/, 'pre-encoded annotations remain literal after root escaping');
  const command = commandDiagnostic({ command: 'node', code: 7, signal: null, stdout: 'a'.repeat(50_000), stderr: `b`.repeat(50_000) + '\nACTUAL FAILURE' });
  assert.equal(command.exitCode, 7);
  assert.ok(command.stdoutTail.length <= 12_000 && command.stderrTail.length <= 12_000);
  assert.match(command.stderrTail, /ACTUAL FAILURE$/);
});

test('failed current helper report is read after nonzero exit and retains actual error/runtime evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'teller-mac-diagnostic-'));
  try {
    const path = join(directory, 'helper.json');
    const report = { ...evidence, status: 'failed', error: { message: '\u001b[31mWebGL2 unavailable\u001b[0m', stack: 'Error: WebGL2 unavailable\n at launch:42' }, consoleErrors: ['GPU context failed'], pageErrors: ['render failed'], checks: [{ name: 'real-image', status: 'failed', message: 'No accepted raster pixels' }], runtimeOnFailure: { platform: 'darwin', arch: 'arm64', gpu: { webgl: 'disabled_off' }, windows: [{ loading: false, destroyed: false, url: 'must-not-copy-unknown-runtime-value' }] }, environment: { token: 'must-not-copy-environment' } };
    await writeFile(path, JSON.stringify(report));
    await assert.rejects(checkAcceptanceReport(path, { command: 'node', code: 1, stdout: 'helper starting', stderr: 'Electron exited before ready' }, { kind: 'packaged-fixture', startedAt: current }), error => {
      assert.match(error.message, /WebGL2 unavailable/);
      const diagnostic = error.diagnostics[0];
      assert.equal(diagnostic.command.exitCode, 1);
      assert.equal(diagnostic.acceptance.currentRun, true);
      assert.equal(diagnostic.acceptance.runtimeOnFailure.gpu.webgl, 'disabled_off');
      assert.deepEqual(diagnostic.acceptance.pageErrors, ['render failed']);
      assert.equal(diagnostic.acceptance.failedChecks[0].name, 'real-image');
      assert.doesNotMatch(JSON.stringify(diagnostic), /must-not-copy/);
      assert.doesNotMatch(error.message, /[\u0000-\u001f]/);
      return true;
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('old/missing reports never replace the current command failure with stale evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'teller-mac-stale-diagnostic-'));
  try {
    const path = join(directory, 'helper.json');
    await writeFile(path, JSON.stringify({ ...evidence, status: 'failed', startedAt: new Date(current - 60_000).toISOString(), error: 'OLD failure must not be reused' }));
    await assert.rejects(checkAcceptanceReport(path, { command: 'node', code: 1, stderr: 'CURRENT spawn failed' }, { kind: 'packaged-live', startedAt: current }), error => {
      assert.equal(error.diagnostics[0].acceptance.status, 'stale-report');
      assert.match(error.diagnostics[0].command.stderrTail, /CURRENT spawn failed/);
      assert.doesNotMatch(JSON.stringify(error.diagnostics), /OLD failure/);
      return true;
    });
    await assert.rejects(checkAcceptanceReport(join(directory, 'missing.json'), { command: 'node', code: 1, stderr: 'Current launch error' }, { kind: 'packaged-live', startedAt: current }), error => {
      assert.equal(error.diagnostics[0].acceptance.status, 'missing-report');
      assert.match(error.diagnostics[0].acceptance.readError, /ENOENT/);
      return true;
    });
    await writeFile(path, JSON.stringify(evidence));
    await assert.rejects(checkAcceptanceReport(path, { command: 'node', code: 1 }, { kind: 'packaged-live', startedAt: current }), /Helper exited 1 despite its report status/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('actual failed subprocess exit and stderr remain attached rather than collapsing to generic exit1', async () => {
  await assert.rejects(run(process.execPath, ['-e', 'require("node:fs").writeSync(2,"Specific native-launch failure\\n"); process.exit(17)'], { capture: true }), error => {
    assert.equal(error.result.code, 17);
    assert.match(error.result.stderr, /Specific native-launch failure/);
    assert.match(error.message, /Specific native-launch failure/);
    return true;
  });
});
