import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { APP_IDENTIFIER, requireMacHost, machoArchitectures, requireBundleInfo, signatureSummary, requireGatekeeper, requireAcceptance, parseMacArguments } from '../scripts/verify-mac.mjs';
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
