#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { open, mkdir, mkdtemp, copyFile, writeFile, readFile, readdir, rm, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import ts from 'typescript';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateFile = path.join(root, '.verification/control.json');
const lock = path.join(root, '.verification/control-lock');
const features = path.join(root, '.agents/skills/verify-writing-sessions/features');
let activeDriver;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
export function processes() {
  return execFileSync('ps', ['-axo', 'pid=,pgid=,args='], { encoding: 'utf8' }).trim().split('\n').map(line => {
    const [, pid, pgid, args] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    return { pid: Number(pid), pgid: Number(pgid), args };
  });
}
export async function readState() {
  try { return JSON.parse(await readFile(stateFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('No verification instance. Run ./scripts/control-writing-sessions dev'); throw error; }
}
function owned(state) {
  assert.equal(path.dirname(state.scratch), path.join(root, '.verification'));
  assert.ok(path.basename(state.scratch).startsWith('run-'));
  assert.equal(state.profile, path.join(state.scratch, 'profile'));
  const group = processes().filter(p => p.pgid === state.pid);
  // Check the owned profile before sending signals, including when only helpers remain.
  if (group.length) assert.ok(group.some(p => p.args.includes(`--user-data-dir=${state.profile}`)), 'Process group no longer matches the owned profile; refusing to signal it');
  return group;
}
export async function waitVaultPage(context, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const page = context.pages().find(candidate => candidate.url().includes('index.html'));
    if (page) return page;
    await sleep(Math.min(100, Math.max(0, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw new Error('No owned Obsidian vault window before readiness timeout');
}
export async function connectInstance(state) {
  assert.ok(owned(state).length, 'Owned Obsidian process is absent; run stop, then dev');
  const [port] = (await readFile(path.join(state.profile, 'DevToolsActivePort'), 'utf8')).split('\n');
  assert.equal(state.endpoint, `http://127.0.0.1:${Number(port)}`);
  const browser = await chromium.connectOverCDP(state.endpoint);
  try {
    const context = browser.contexts()[0];
    const page = await waitVaultPage(context);
    await page.waitForFunction(() => typeof app !== 'undefined' && app.workspace?.layoutReady, null, { timeout: 30_000 });
    assert.equal(await page.evaluate(() => app.vault.adapter.getBasePath()), state.vault, 'Unexpected vault; refusing to drive');
    page.setDefaultTimeout(10_000);
    return { browser, context, page };
  } catch (error) { await browser.close(); throw error; }
}
async function doctor() {
  try {
    const owner = JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8'));
    assert.equal(owner.pid, process.pid, `Control command ${owner.pid} is active; wait for it before doctor`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Install Node.js 24+, then npm ci');
  await access(path.join(root, 'node_modules/playwright-core/package.json'));
  const state = await readState();
  for (const [file, expected] of Object.entries(state.hashes)) {
    assert.equal(await digest(path.join(root, file)), expected, `${file} changed; run stop, then dev`);
    assert.equal(await digest(path.join(state.pluginDir, file)), expected, `Installed ${file} differs; run stop, then dev`);
  }
  const { browser, page } = await connectInstance(state);
  try {
    assert.equal(await page.evaluate(() => app.plugins.plugins['writing-sessions']?.manifest.version), state.version);
    assert.equal(await page.locator('.writing-sessions-status').count(), 1);
    console.log(`PASS doctor: owned PID ${state.pid}, ${state.endpoint}, disposable vault, plugin ${state.version}, exact build hashes; no auth required`);
    console.log(`Evidence: ${state.evidence}`);
  } finally { await browser.close(); }
}
async function launch() {
  try { await access(stateFile); throw new Error('An instance is already recorded. Run doctor or stop; never double-drive it.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  const before = processes();
  const scratch = await mkdtemp(path.join(root, '.verification/run-'));
  const evidence = path.join(root, '.verification/evidence', path.basename(scratch));
  const profile = path.join(scratch, 'profile');
  const vault = path.join(scratch, 'Writing Sessions Test');
  const pluginDir = path.join(vault, '.obsidian/plugins/writing-sessions');
  const state = { scratch, profile, vault, pluginDir, evidence, hashes: {}, pid: null, endpoint: null, version: JSON.parse(await readFile(path.join(root, 'manifest.json'))).version };
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'processes-before.json'), JSON.stringify(before, null, 2));
  try {
    await mkdir(profile); await mkdir(pluginDir, { recursive: true });
    for (const file of ['main.js', 'manifest.json', 'styles.css']) {
      await copyFile(path.join(root, file), path.join(pluginDir, file));
      state.hashes[file] = await digest(path.join(root, file));
    }
    await writeFile(path.join(pluginDir, 'data.json'), JSON.stringify({ version: 2, target: 10, mode: 'added', sessions: [], ownership: {} }));
    await writeFile(path.join(vault, '.obsidian/community-plugins.json'), '["writing-sessions"]');
    await writeFile(path.join(vault, '.obsidian/core-plugins.json'), '["file-explorer","switcher","command-palette"]');
    await writeFile(path.join(vault, '.obsidian/app.json'), JSON.stringify({ livePreview: false, showInlineTitle: false, spellcheck: false }));
    for (const file of ['Draft.md', 'Second note.md', 'Paused note.md']) await writeFile(path.join(vault, file), '');
    await writeFile(path.join(profile, 'obsidian.json'), JSON.stringify({ vaults: { '1111111111111111': { path: vault, ts: Date.now(), open: true } } }));
    let archive = process.env.OBSIDIAN_ASAR;
    if (!archive && process.platform === 'darwin') {
      const support = path.join(homedir(), 'Library/Application Support/obsidian');
      const archives = (await readdir(support)).filter(file => /^obsidian-\d+\.\d+\.\d+\.asar$/.test(file)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (archives.length) archive = path.join(support, archives.at(-1));
    }
    if (archive) { state.archive = path.basename(archive); await copyFile(archive, path.join(profile, state.archive)); }
    const log = await open(path.join(evidence, 'app.log'), 'a');
    const child = spawn(process.env.OBSIDIAN_BINARY ?? '/Applications/Obsidian.app/Contents/MacOS/Obsidian', [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', ...(process.env.CI ? ['--no-sandbox'] : [])], { detached: true, stdio: ['ignore', log.fd, log.fd] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    state.pid = child.pid; child.unref(); await log.close();
    await writeFile(stateFile, JSON.stringify(state)); // Recovery record exists before waiting for readiness.
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const [port] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n');
        assert.match(port, /^\d+$/); state.endpoint = `http://127.0.0.1:${Number(port)}`; break;
      } catch { await sleep(200); }
    }
    assert.ok(state.endpoint, `No CDP endpoint; inspect ${evidence}/app.log. Check OBSIDIAN_BINARY and OBSIDIAN_ASAR.`);
    await writeFile(stateFile, JSON.stringify(state));
    const { browser, context, page } = await connectInstance(state);
    try {
      const trust = page.getByRole('button', { name: /trust.*enable|turn on community plugins/i });
      if (await trust.count()) await trust.first().click();
      await page.locator('.writing-sessions-status').waitFor({ timeout: 15_000 });
      if (context.pages().length === 1) await context.waitForEvent('page', { timeout: 2000 }).catch(() => {});
      for (const auxiliary of context.pages()) if (auxiliary !== page) await auxiliary.close();
    } finally { await browser.close(); }
    await writeFile(path.join(evidence, 'build.json'), JSON.stringify({ ...state, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }) }, null, 2));
    console.log(`PASS dev: ready; evidence ${evidence}`);
  } catch (error) {
    if (state.pid) { await writeFile(stateFile, JSON.stringify(state)); await stop(); }
    else await rm(scratch, { recursive: true, force: true });
    throw error;
  }
}
async function stop() {
  let state;
  try { state = await readState(); } catch (error) { if (error.message.startsWith('No verification instance.')) { console.log('PASS stop: no instance recorded'); return; } throw error; }
  if (owned(state).length) {
    process.kill(-state.pid, 'SIGTERM');
    for (let i = 0; i < 50 && processes().some(p => p.pgid === state.pid); i++) await sleep(100);
    if (processes().some(p => p.pgid === state.pid)) process.kill(-state.pid, 'SIGKILL');
    for (let i = 0; i < 50 && processes().some(p => p.pgid === state.pid); i++) await sleep(100);
  }
  const after = processes();
  await writeFile(path.join(state.evidence, 'processes-after.json'), JSON.stringify(after, null, 2));
  assert.ok(!after.some(p => p.pgid === state.pid || p.args.includes(state.profile)), 'Owned processes remain; scratch retained for recovery');
  await rm(state.scratch, { recursive: true, force: true });
  await rm(stateFile);
  console.log(`PASS stop: owned process group and scratch removed; evidence retained at ${state.evidence}`);
}
export async function map(check, options = {}) {
  const featureDir = options.features ?? features;
  const source = ts.createSourceFile('main.ts', options.source ?? await readFile(path.join(root, 'src/main.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const inventory = new Set();
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (method === 'addCommand') {
        const id = node.arguments[0]?.properties?.find(p => p.name?.getText(source) === 'id')?.initializer;
        assert.ok(id && ts.isStringLiteral(id), 'Command has no static id; extend the inventory parser');
        inventory.add(`command:${id.text}`);
      }
      if (method === 'setName') {
        assert.ok(ts.isStringLiteral(node.arguments[0]), 'Setting name is dynamic; extend the inventory parser');
        inventory.add(`setting:${node.arguments[0].text}`);
      }
      if (method === 'addStatusBarItem') inventory.add('entry:status-bar');
      if (method === 'addSettingTab') inventory.add('entry:settings-tab');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  console.log([...inventory].sort().join('\n'));
  if (!check) return;
  const index = await readFile(path.join(featureDir, 'README.md'), 'utf8');
  const indexed = [...index.matchAll(/\]\(\.\/([^/)]+\.md)\)/g)].map(match => match[1]);
  const files = (await readdir(featureDir)).filter(file => file.endsWith('.md') && file !== 'README.md');
  assert.deepEqual([...new Set(indexed)].sort(), files.sort(), 'Feature README index has missing or orphaned files');
  assert.equal(indexed.length, files.length, 'Duplicate feature index entry');
  const covered = new Set();
  for (const file of files) {
    const body = await readFile(path.join(featureDir, file), 'utf8');
    assert.deepEqual([...body.matchAll(/^## (.+)$/gm)].map(m => m[1]), ['Sub-features', 'How to get to it (user POV)', 'Driving it with control-writing-sessions', 'Gotchas'], `${file}: feature headings differ`);
    const refs = [...body.matchAll(/<!-- surface: (.+?) -->/g)].map(m => m[1]);
    assert.ok(refs.length, `${file} has no inventory references`);
    for (const ref of refs) { assert.ok(inventory.has(ref), `${file} cites missing surface ${ref}`); covered.add(ref); }
  }
  for (const surface of inventory) assert.ok(covered.has(surface), `Unmapped surface ${surface}`);
  console.log(`PASS map: ${inventory.size} source surfaces covered by ${files.length} indexed features`);
}
async function drive() {
  await doctor();
  const state = await readState();
  assert.ok(!state.driven, 'Smoke requires a fresh fixture. Run stop, then dev.');
  state.driven = true; await writeFile(stateFile, JSON.stringify(state));
  const log = await open(path.join(state.evidence, 'drive.log'), 'a');
  let writes = Promise.resolve();
  try {
    const child = activeDriver = spawn(process.execPath, [path.join(root, 'scripts/smoke.mjs')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { process.stdout.write(data); writes = writes.then(() => log.write(data)); });
    child.stderr.on('data', data => { process.stderr.write(data); writes = writes.then(() => log.write(data)); });
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Smoke exited ${code}; see ${state.evidence}`))); });
  } catch (error) { await stop(); throw error; }
  finally { activeDriver = undefined; await writes; await log.close(); }
}
async function main() {
  const [command, arg, ...extra] = process.argv.slice(2);
  assert.equal(extra.length, 0, 'Unexpected extra arguments');
  if (command === 'map') { assert.ok(!arg || arg === '--check'); return map(arg === '--check'); }
  if (command === 'doctor') return doctor();
  if (!command || command === 'help' || command === '--help') {
    console.log('./scripts/control-writing-sessions doctor | dev | drive smoke | stop | map [--check] | smoke\nNode 24+, npm ci. Optional OBSIDIAN_BINARY and OBSIDIAN_ASAR. All app interaction uses an owned disposable instance.'); return;
  }
  await mkdir(path.dirname(lock), { recursive: true });
  try { await mkdir(lock); } catch (error) { if (error.code === 'EEXIST') throw new Error('Another control command holds .verification/control-lock; wait for it.'); throw error; }
  await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, command, startedAt: new Date().toISOString() }));
  const interrupted = async signal => {
    activeDriver?.kill('SIGTERM');
    try { await stop(); } catch (error) { console.error(`Interrupted cleanup: ${error.message}`); }
    await rm(lock, { recursive: true, force: true });
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  const onInt = () => { void interrupted('SIGINT'); };
  const onTerm = () => { void interrupted('SIGTERM'); };
  process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
  try {
    if (command === 'dev' && !arg) return await launch();
    if (command === 'stop' && !arg) return await stop();
    if (command === 'drive' && arg === 'smoke') return await drive();
    if (command === 'smoke' && !arg) { await launch(); try { await drive(); } finally { await stop(); } return; }
    throw new Error('Unknown command; run ./scripts/control-writing-sessions --help');
  } finally { process.off('SIGINT', onInt); process.off('SIGTERM', onTerm); await rm(lock, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
