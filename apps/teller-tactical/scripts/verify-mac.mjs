#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APP_IDENTIFIER = 'tools.tellertactical.desktop';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arm64 = 0x0100000c;

export function appleVersion(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(value)) throw new Error('macOS version must be a numeric major.minor[.patch] value.');
  return value.split('.').map(Number);
}
function atLeast(current, minimum) {
  const a = appleVersion(current), b = appleVersion(minimum);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}
export function requireMacHost({ platform, arch, version }) {
  if (platform !== 'darwin') throw new Error('Native Mac acceptance requires macOS; a Linux cross-build cannot pass this gate.');
  if (arch !== 'arm64') throw new Error('Native Mac acceptance requires Apple Silicon arm64, not Intel or translated x64 Node.');
  if (!atLeast(version, '13.0')) throw new Error('Teller Tactical requires macOS 13.0 or later.');
  return { platform, arch, version };
}
export function machoArchitectures(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < 8) throw new Error('Executable is not a complete Mach-O header.');
  const magicLE = bytes.readUInt32LE(0), magicBE = bytes.readUInt32BE(0);
  let cpuTypes;
  if (magicLE === 0xfeedfacf) {
    if (bytes.length < 32) throw new Error('64-bit Mach-O header is truncated.');
    cpuTypes = [bytes.readUInt32LE(4)];
  }
  else if ([0xcafebabe, 0xcafebabf].includes(magicBE)) {
    const count = bytes.readUInt32BE(4), stride = magicBE === 0xcafebabf ? 32 : 20;
    if (!count || count > 32 || bytes.length < 8 + count * stride) throw new Error('Universal Mach-O header is truncated or exceeds the architecture limit.');
    cpuTypes = Array.from({ length: count }, (_, index) => bytes.readUInt32BE(8 + index * stride));
  } else throw new Error('Executable is not a supported Mach-O image.');
  return cpuTypes.map(cpu => cpu === arm64 ? 'arm64' : cpu === 0x01000007 ? 'x64' : `cpu-${cpu}`);
}
export function requireBundleInfo(info, host, architectures) {
  if (info?.CFBundleIdentifier !== APP_IDENTIFIER) throw new Error('Bundle identifier does not identify Teller Tactical.');
  if (info.CFBundleExecutable !== 'Teller Tactical') throw new Error('Bundle executable declaration is unexpected.');
  if (typeof info.CFBundleShortVersionString !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(info.CFBundleShortVersionString)) throw new Error('Bundle version is missing or malformed.');
  if (!architectures.includes('arm64')) throw new Error('The packaged executable does not contain Apple Silicon arm64 code.');
  if (!atLeast(host.version, info.LSMinimumSystemVersion)) throw new Error('The target Mac is older than the packaged minimum macOS version.');
  return { identifier: info.CFBundleIdentifier, version: info.CFBundleShortVersionString, minimumMacOS: info.LSMinimumSystemVersion, architectures };
}
export function signatureSummary(text, mode) {
  if (!['developer', 'distribution'].includes(mode)) throw new Error('Unknown Mac verification mode.');
  const adhoc = /(?:Signature=adhoc|flags=[^\n]*\badhoc\b)/i.test(text);
  const developerID = /^Authority=Developer ID Application: .+$/m.test(text);
  const hardenedRuntime = /^CodeDirectory[^\n]*flags=[^\n]*\bruntime\b/m.test(text);
  const timestamped = /^Timestamp=.+$/m.test(text);
  const teamIdentifier = /^TeamIdentifier=(?!not set$)[A-Z0-9]+$/m.test(text);
  if (!adhoc && !developerID) throw new Error('The app is neither an explicitly ad-hoc developer build nor Developer ID signed.');
  if (mode === 'distribution' && (!developerID || adhoc || !hardenedRuntime || !timestamped || !teamIdentifier)) throw new Error('Distribution requires Developer ID, hardened runtime, secure timestamp and a team identifier; ad-hoc builds cannot pass.');
  return { kind: adhoc ? 'adhoc-developer' : 'Developer-ID-Application', hardenedRuntime, timestamped, teamIdentifierPresent: teamIdentifier };
}
export function requireGatekeeper({ code, output }) {
  if (code !== 0 || !/: accepted\s*$/m.test(output) || !/^source=Notarized Developer ID\s*$/m.test(output)) throw new Error('Gatekeeper did not accept a notarized Developer ID application. No security override is permitted.');
  return { accepted: true, source: 'Notarized Developer ID' };
}
export function requireAcceptance(report, { kind, startedAt }) {
  if (report?.status !== 'passed' || !Array.isArray(report.checks) || !report.checks.length || report.checks.some(check => check.status !== 'passed')) throw new Error(`${kind} acceptance did not complete with meaningful passing checks.`);
  if (!Number.isFinite(Date.parse(report.startedAt)) || Date.parse(report.startedAt) < startedAt - 1000) throw new Error(`${kind} result is not from the current validation run.`);
  if (kind === 'backend-live') {
    if (report.fixture !== false) throw new Error('Live acceptance cannot use synthetic or unmarked data.');
  } else {
    if (report.host?.platform !== 'darwin' || report.host?.arch !== 'arm64') throw new Error(`${kind} did not execute on Apple Silicon macOS.`);
    if (!Array.isArray(report.launchFlags) || !Array.isArray(report.consoleErrors) || !Array.isArray(report.pageErrors)) throw new Error(`${kind} omitted runtime/security/error evidence.`);
    if (report.launchFlags.some(value => /swiftshader|no-sandbox|disable-gpu|ignore-gpu-blocklist/i.test(value))) throw new Error(`${kind} must use the Mac's normal GPU/security path; software or sandbox overrides cannot pass.`);
    if (report.consoleErrors?.length || report.pageErrors?.length) throw new Error(`${kind} contains JavaScript errors.`);
    if (kind === 'packaged-live' && report.fixture !== false) throw new Error('Packaged live acceptance used synthetic or unmarked data.');
  }
  return { passed: true, checks: report.checks.length, scope: kind };
}
export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export function run(command, args, { cwd = ROOT, env = process.env, capture = false, allowFailure = false } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let stdout = '', stderr = '', bytes = 0, exceeded = false;
    if (capture) {
      const record = (chunk, target) => { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) { exceeded = true; child.kill('SIGTERM'); return; } if (target === 'out') stdout += chunk; else stderr += chunk; };
      child.stdout.on('data', chunk => record(chunk, 'out'));
      child.stderr.on('data', chunk => record(chunk, 'err'));
    }
    child.once('error', reject);
    child.once('close', code => {
      if (exceeded) return reject(new Error(`${command} output exceeded its safety bound.`));
      const result = { code, stdout, stderr, output: stdout + stderr };
      if (code !== 0 && !allowFailure) reject(Object.assign(new Error(`${command} failed with exit ${code}; inspect the release Mac's command diagnostics.`), { result }));
      else resolveResult(result);
    });
  });
}
export async function inspectMacHost() {
  // Reject before invoking macOS tools; a Linux host must never emit a passing report.
  if (process.platform !== 'darwin' || process.arch !== 'arm64') requireMacHost({ platform: process.platform, arch: process.arch, version: '13.0' });
  const version = (await run('/usr/bin/sw_vers', ['-productVersion'], { capture: true })).stdout.trim();
  return requireMacHost({ platform: process.platform, arch: process.arch, version });
}
export async function inspectBundle(app, { host, mode = 'developer' }) {
  const bundlePath = resolve(app);
  if (!bundlePath.endsWith('.app')) throw new Error('Provide the native .app bundle path.');
  const plist = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(bundlePath, 'Contents/Info.plist')], { capture: true });
  const info = JSON.parse(plist.stdout);
  if (info.CFBundleIdentifier !== APP_IDENTIFIER || info.CFBundleExecutable !== 'Teller Tactical') throw new Error('Bundle identity/executable declaration is unexpected.');
  const executable = join(bundlePath, 'Contents/MacOS/Teller Tactical');
  const executableFile = await open(executable, 'r');
  let architectures;
  try {
    const header = Buffer.alloc(8 + 32 * 32);
    const { bytesRead } = await executableFile.read(header, 0, header.length, 0);
    architectures = machoArchitectures(header.subarray(0, bytesRead));
  } finally { await executableFile.close(); }
  const metadata = requireBundleInfo(info, host, architectures);
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundlePath], { capture: true });
  const signature = signatureSummary((await run('/usr/bin/codesign', ['--display', '--verbose=4', bundlePath], { capture: true })).output, mode);
  const hashes = { executable: await sha256File(executable), appAsar: await sha256File(join(bundlePath, 'Contents/Resources/app.asar')) };
  return { bundlePath, executable, metadata, signature, hashes };
}
export async function verifyMac({ app = join(ROOT, 'release/Teller Tactical-darwin-arm64/Teller Tactical.app'), mode = 'developer', reportPath = join(ROOT, 'release/macos-verification/acceptance.json') } = {}) {
  const startedAt = Date.now(), output = resolve(reportPath), directory = dirname(output);
  const report = { status: 'failed', startedAt: new Date(startedAt).toISOString(), mode, host: { platform: process.platform, arch: process.arch }, checks: [], distributionReady: false, scope: 'Native Apple Silicon package, source unit checks, fixture workflow, public-source live checks and actual packaged live weather. Not a claim that all planned advanced features are implemented.' };
  await mkdir(directory, { recursive: true });
  try {
    if (!['developer', 'distribution'].includes(mode)) throw new Error('Mac mode must be developer or distribution.');
    const host = await inspectMacHost(); report.host = host;
    const before = await inspectBundle(app, { host, mode }); report.bundle = before;
    const source = await run('npm', ['test'], { capture: true, allowFailure: true });
    await writeFile(join(directory, 'unit-tests.txt'), source.output);
    if (source.code !== 0) throw new Error('Source tests failed; see unit-tests.txt for current-run diagnostics.');
    const count = /(?:#|ℹ)\s*tests\s+(\d+)/.exec(source.output)?.[1];
    if (!count || Number(count) < 1) throw new Error('Source test runner executed no tests.');
    report.checks.push({ name: 'source-tests', status: 'passed', tests: Number(count) });
    const fixturePath = join(directory, 'packaged-fixture.json');
    await run(process.execPath, [join(ROOT, 'scripts/packaged-smoke.mjs'), before.executable], { env: { ...process.env, TELLER_PACKAGED_REPORT: fixturePath } });
    report.checks.push({ name: 'packaged-fixture', status: 'passed', ...requireAcceptance(JSON.parse(await readFile(fixturePath, 'utf8')), { kind: 'packaged-fixture', startedAt }) });
    const { runLiveSmoke } = await import('./live-smoke.mjs');
    const livePath = join(directory, 'backend-live.json');
    const live = await runLiveSmoke({ reportPath: livePath });
    report.checks.push({ name: 'backend-live', status: 'passed', ...requireAcceptance(live, { kind: 'backend-live', startedAt }) });
    const packagedLivePath = join(directory, 'packaged-live.json');
    await access(join(ROOT, 'scripts/packaged-live-smoke.mjs'));
    await run(process.execPath, [join(ROOT, 'scripts/packaged-live-smoke.mjs'), before.executable], { env: { ...process.env, TELLER_PACKAGED_LIVE_REPORT: packagedLivePath } });
    report.checks.push({ name: 'packaged-live', status: 'passed', ...requireAcceptance(JSON.parse(await readFile(packagedLivePath, 'utf8')), { kind: 'packaged-live', startedAt }) });
    const after = await inspectBundle(app, { host, mode });
    if (after.hashes.executable !== before.hashes.executable || after.hashes.appAsar !== before.hashes.appAsar) throw new Error('Application bytes changed during acceptance; rebuild and verify the actual final package.');
    if (mode === 'distribution') {
      await run('/usr/bin/xcrun', ['stapler', 'validate', before.bundlePath], { capture: true });
      const assessment = await run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', before.bundlePath], { capture: true, allowFailure: true });
      report.gatekeeper = requireGatekeeper(assessment);
      report.distributionReady = true;
      report.checks.push({ name: 'notarization-staple-and-Gatekeeper', status: 'passed' });
    }
    report.status = 'passed';
  } catch (error) { report.error = error.message; }
  report.finishedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  return report;
}
export function parseMacArguments(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (!['--app', '--mode', '--report'].includes(name) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: verify-mac.mjs [--app /path/Teller Tactical.app] [--mode developer|distribution] [--report /absolute/report.json]');
    result[name.slice(2) === 'report' ? 'reportPath' : name.slice(2)] = args[++i];
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await verifyMac(parseMacArguments(process.argv.slice(2)));
    console.log(JSON.stringify({ status: report.status, mode: report.mode, host: report.host, checks: report.checks, distributionReady: report.distributionReady, error: report.error }, null, 2));
    process.exitCode = report.status === 'passed' ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
