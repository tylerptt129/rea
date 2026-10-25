#!/usr/bin/env node
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { releaseMac } from './release-mac.mjs';
import { ROOT, diagnosticText, inspectBundle, inspectMacHost, requireMacHost, run, sourceQualityFields } from './verify-mac.mjs';

const appName = 'Teller Tactical.app';
const reportPath = join(ROOT, 'release/macos-verification/installed-local.json');
const within = (parent, child) => { const path = relative(parent, child); return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`); };
const sameHashes = (actual, expected) => ['executable', 'appAsar'].every(key => /^[a-f0-9]{64}$/.test(expected?.[key] ?? '') && actual?.[key] === expected[key]);
const json = async path => JSON.parse(await readFile(path, 'utf8'));

async function destinationDirectory(input, source) {
  const requested = resolve(input);
  let parent = requested;
  for (;;) {
    try {
      const canonical = resolve(await realpath(parent), relative(parent, requested));
      const allowed = await Promise.all([homedir(), tmpdir()].map(path => realpath(path)));
      if (!allowed.some(path => within(path, canonical))) throw new Error('Local installation destination must be inside your home or temporary directory; system installation is not supported.');
      if (within(source, canonical) || within(canonical, source)) throw new Error('Installation destination must be separate from the verified source bundle.');
      await mkdir(canonical, { recursive: true });
      return await realpath(canonical);
    } catch (error) {
      if (error.code !== 'ENOENT' || dirname(parent) === parent) throw error;
      parent = dirname(parent);
    }
  }
}

async function verifiedDeveloper(host) {
  const release = await json(join(ROOT, 'release/macos-release.json'));
  const acceptance = await json(join(ROOT, 'release/macos-verification/acceptance.json'));
  const required = ['source-tests', 'packaged-fixture', 'backend-live', 'packaged-live'];
  for (const report of [release, acceptance]) {
    if (report.status !== 'passed' || report.mode !== 'developer') throw new Error('Installation requires a passed native developer release and acceptance report. Run npm run install:mac to rebuild and validate.');
    requireMacHost(report.host ?? {});
    if (!Array.isArray(report.checks) || report.checks.some(check => check.status !== 'passed') || required.some(name => !report.checks.some(check => check.name === name))) throw new Error('Required native release checks are incomplete.');
  }
  const times = [release.startedAt, acceptance.startedAt, acceptance.finishedAt, release.finishedAt].map(Date.parse);
  if (!times.every(Number.isFinite) || times.some((time, index) => index && time < times[index - 1]) || times.at(-1) > Date.now() + 60_000 || release.verification?.status !== 'passed') throw new Error('Release and acceptance reports do not describe the same completed native run.');
  const quality = sourceQualityFields(acceptance, { required: true });
  if (JSON.stringify(sourceQualityFields(release, { required: true })) !== JSON.stringify(quality)) throw new Error('Release and acceptance source-quality evidence disagree.');
  const app = join(ROOT, 'release/Teller Tactical-darwin-arm64', appName);
  const bundle = await inspectBundle(app, { host, mode: 'developer' });
  if (!sameHashes(bundle.hashes, release.bundleHashes) || !sameHashes(bundle.hashes, acceptance.bundle?.hashes)) throw new Error('Application executable or ASAR differs from the accepted release; rebuild and validate before installing.');
  const packageInfo = await json(join(ROOT, 'package.json'));
  if (release.artifact?.version !== bundle.metadata.version || packageInfo.version !== bundle.metadata.version || release.artifact?.architecture !== 'arm64') throw new Error('Accepted release version/architecture does not match the current bundle.');
  return { app, hashes: bundle.hashes, verificationFinishedAt: acceptance.finishedAt, ...quality };
}

export async function installMac({ fromVerified = false, destination = join(homedir(), 'Applications'), noOpen = false } = {}) {
  const report = { status: 'failed', host: { platform: process.platform, arch: process.arch }, startedAt: new Date().toISOString(), distributionReady: false, sourceHealth: 'not-yet-verified', qualityWarnings: [], backupPath: null, opened: false, scope: 'User-local source installation; ad-hoc developer validation is not notarized distribution.' };
  let staging, previousMoved = false, installed = false;
  try {
    report.host = await inspectMacHost();
    if (!fromVerified) {
      const release = await releaseMac({ mode: 'developer' });
      if (release.status !== 'passed') throw new Error(`Native release validation failed: ${release.error ?? 'required acceptance did not complete'}`);
    }
    const accepted = await verifiedDeveloper(report.host);
    Object.assign(report, { hashes: accepted.hashes, verificationFinishedAt: accepted.verificationFinishedAt, sourceHealth: accepted.sourceHealth, qualityWarnings: accepted.qualityWarnings });
    const directory = await destinationDirectory(destination, accepted.app);
    const target = join(directory, appName); report.installedPath = target;
    let existing;
    try { existing = await lstat(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('Existing installation path is not an ordinary app directory; it was left unchanged.');
    staging = await mkdtemp(join(directory, '.teller-install-'));
    const stagedApp = join(staging, appName);
    await run('/usr/bin/ditto', [accepted.app, stagedApp], { capture: true });
    const copied = await inspectBundle(stagedApp, { host: report.host, mode: 'developer' });
    if (!sameHashes(copied.hashes, accepted.hashes)) throw new Error('Copied bundle fingerprints differ from the accepted release; existing installation was left unchanged.');
    if (existing) {
      report.backupPath = join(directory, `Teller Tactical.backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.app`);
      await rename(target, report.backupPath); previousMoved = true;
    }
    try { await rename(stagedApp, target); installed = true; }
    catch (error) { if (previousMoved) { await rename(report.backupPath, target); previousMoved = false; report.backupPath = null; } throw error; }
    report.signature = copied.signature;
    if (!noOpen) { await run('/usr/bin/open', ['-n', target], { capture: true }); report.opened = true; }
    report.status = 'passed';
  } catch (error) { report.error = diagnosticText(error, 2400); }
  finally {
    if (staging) { try { await rm(staging, { recursive: true, force: true }); } catch (error) { report.status = 'failed'; report.cleanupError = diagnosticText(error); } }
    report.installed = installed;
    report.finishedAt = new Date().toISOString();
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

export function parseInstallArguments(args) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--from-verified') result.fromVerified = true;
    else if (option === '--no-open') result.noOpen = true;
    else if (option === '--destination' && args[index + 1] && !args[index + 1].startsWith('--')) result.destination = args[++index];
    else throw new Error('Usage: install-mac.mjs [--from-verified] [--destination DIRECTORY] [--no-open]');
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await installMac(parseInstallArguments(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === 'passed' ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
