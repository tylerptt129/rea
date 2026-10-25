#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, inspectMacHost, inspectBundle, run, sha256File, verifyMac, diagnosticText, failureDiagnostic } from './verify-mac.mjs';

export function requireReleaseConfiguration(mode, environment = process.env) {
  if (!['developer', 'distribution'].includes(mode)) throw new Error('Release mode must be developer or distribution.');
  if (mode === 'developer') return { mode, identity: '-', distributionReady: false };
  const identity = environment.TELLER_MAC_SIGN_IDENTITY;
  const notaryProfile = environment.TELLER_NOTARY_PROFILE;
  if (typeof identity !== 'string' || !identity.startsWith('Developer ID Application: ') || identity.length > 300 || /[\r\n]/.test(identity)) throw new Error('Distribution requires an explicitly selected, installed Developer ID Application identity in the release Mac keychain.');
  if (typeof notaryProfile !== 'string' || !/^[A-Za-z0-9_. -]{1,100}$/.test(notaryProfile)) throw new Error('Distribution requires an existing notarytool keychain profile selected by TELLER_NOTARY_PROFILE; do not provide secret values in chat.');
  const keychain = environment.TELLER_MAC_KEYCHAIN || undefined;
  if (keychain !== undefined && (typeof keychain !== 'string' || !keychain || /[\r\n\0]/.test(keychain))) throw new Error('Invalid signing keychain selector.');
  return { mode, identity, notaryProfile, ...(keychain ? { keychain } : {}), distributionReady: false };
}
export function requireAcceptedNotarization(value) {
  if (value?.status !== 'Accepted' || typeof value.id !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value.id)) throw new Error('Apple did not accept the notarization submission. No release artifact will be marked distributable.');
  return { status: 'Accepted', id: value.id };
}
export function artifactName(version, mode) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) throw new Error('Package version is not safe for a release filename.');
  if (!['developer', 'distribution'].includes(mode)) throw new Error('Unknown release mode.');
  return `Teller-Tactical-${version}-mac-arm64-${mode === 'distribution' ? 'SIGNED-NOTARIZED' : 'DEVELOPER-NOT-NOTARIZED'}.zip`;
}
async function archiveApp(app, output) {
  await rm(output, { force: true });
  await run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, output]);
  await run('/usr/bin/unzip', ['-t', output], { capture: true });
}
export async function releaseMac({ mode = 'developer' } = {}) {
  const report = { status: 'failed', startedAt: new Date().toISOString(), mode, distributionReady: false, scope: 'Native Apple Silicon release gates; no remote repository publication or deployment.' };
  const releaseDirectory = join(ROOT, 'release'), reportPath = join(releaseDirectory, 'macos-release.json');
  await mkdir(releaseDirectory, { recursive: true });
  let temporary;
  try {
    const host = await inspectMacHost(); report.host = host;
    const configuration = requireReleaseConfiguration(mode);
    const packageInfo = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
    if (packageInfo.name !== 'teller-tactical') throw new Error('Release must run from the independent Teller Tactical source checkout.');
    await run('npm', ['run', 'package:mac']);
    const app = join(releaseDirectory, 'Teller Tactical-darwin-arm64/Teller Tactical.app');
    temporary = await mkdtemp(join(tmpdir(), 'teller-mac-sign-'));
    const entitlements = join(temporary, 'entitlements.plist');
    await writeFile(entitlements, '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>', { mode: 0o600 });
    const { sign } = await import('@electron/osx-sign');
    await sign({
      app, platform: 'darwin', type: mode === 'distribution' ? 'distribution' : 'development',
      identity: configuration.identity, identityValidation: mode === 'distribution',
      ...(configuration.keychain ? { keychain: configuration.keychain } : {}),
      preAutoEntitlements: false, preEmbedProvisioningProfile: false, strictVerify: true,
      optionsForFile: () => ({ entitlements, hardenedRuntime: true, ...(mode === 'developer' ? { timestamp: 'none' } : {}) }),
    });
    report.signing = { kind: mode === 'distribution' ? 'Developer-ID-Application' : 'adhoc-local-developer', privateKeysExported: false };
    await inspectBundle(app, { host, mode });
    if (mode === 'distribution') {
      const upload = join(temporary, 'notarization-submission.zip');
      await archiveApp(app, upload);
      const response = await run('/usr/bin/xcrun', ['notarytool', 'submit', upload, '--keychain-profile', configuration.notaryProfile, '--wait', '--output-format', 'json'], { capture: true });
      report.notarization = requireAcceptedNotarization(JSON.parse(response.stdout));
      await run('/usr/bin/xcrun', ['stapler', 'staple', app], { capture: true });
    }
    const verification = await verifyMac({ app, mode, reportPath: join(releaseDirectory, 'macos-verification/acceptance.json') });
    report.verification = { status: verification.status, error: verification.error, checks: verification.checks, diagnostics: verification.diagnostics ?? [] };
    if (verification.status !== 'passed' || (mode === 'distribution' && !verification.distributionReady)) throw Object.assign(new Error(`Mac acceptance failed: ${verification.error ?? 'required checks did not complete'}`), { diagnostics: verification.diagnostics ?? [] });
    const archive = join(releaseDirectory, artifactName(packageInfo.version, mode));
    await archiveApp(app, archive);
    report.artifact = { filename: artifactName(packageInfo.version, mode), sha256: await sha256File(archive), version: packageInfo.version, architecture: 'arm64' };
    report.bundleHashes = verification.bundle.hashes;
    report.checks = verification.checks;
    report.distributionReady = verification.distributionReady;
    report.status = 'passed';
  } catch (error) { report.error = diagnosticText(error, 3000); report.diagnostics = error.diagnostics ?? [failureDiagnostic(error)]; }
  finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
  report.finishedAt = new Date().toISOString();
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  return report;
}
export function parseReleaseArguments(args) {
  if (args.length === 0) return { mode: 'developer' };
  if (args.length !== 2 || args[0] !== '--mode' || !['developer', 'distribution'].includes(args[1])) throw new Error('Usage: release-mac.mjs [--mode developer|distribution]');
  return { mode: args[1] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await releaseMac(parseReleaseArguments(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === 'passed' ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
