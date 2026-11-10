import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, copyFile, writeFile, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = process.cwd();
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
await mkdir('.verification', { recursive: true });
const scratch = await mkdtemp(path.join(root, '.verification/run-'));
const profile = path.join(scratch, 'profile');
const vault = path.join(scratch, 'Writing Sessions Test');
const pluginDir = path.join(vault, '.obsidian/plugins/writing-sessions');
const screenshots = path.join(root, 'docs/screenshots');
let child;
let browser;
const result = { archive: null, checks: [], errors: [] };
const check = description => { result.checks.push(description); console.log(`PASS ${description}`); };
try {
  await mkdir(profile, { recursive: true });
  await mkdir(pluginDir, { recursive: true });
  await mkdir(screenshots, { recursive: true });
  await mkdir('release', { recursive: true });
  for (const file of ['main.js', 'manifest.json', 'styles.css']) await copyFile(file, path.join(pluginDir, file));
  await writeFile(path.join(vault, '.obsidian/community-plugins.json'), '["writing-sessions"]');
  await writeFile(path.join(vault, '.obsidian/core-plugins.json'), '["file-explorer","switcher","command-palette"]');
  await writeFile(path.join(vault, '.obsidian/app.json'), JSON.stringify({ livePreview: false, showInlineTitle: false, spellcheck: false }));
  await writeFile(path.join(vault, 'Draft.md'), '');
  await writeFile(path.join(vault, 'Second note.md'), '');
  await writeFile(path.join(profile, 'obsidian.json'), JSON.stringify({ vaults: { '1111111111111111': { path: vault, ts: Date.now(), open: true } } }));
  let archive = process.env.OBSIDIAN_ASAR;
  if (!archive && process.platform === 'darwin') {
    const support = path.join(homedir(), 'Library/Application Support/obsidian');
    const archives = (await readdir(support)).filter(file => /^obsidian-\d+\.\d+\.\d+\.asar$/.test(file));
    archives.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    let runningVersion;
    try { runningVersion = execFileSync('obsidian', ['version'], { encoding: 'utf8', timeout: 5000 }).match(/^\d+\.\d+\.\d+/)?.[0]; } catch { /* CLI is optional. */ }
    const runningArchive = archives.find(file => file === `obsidian-${runningVersion}.asar`);
    archive = archives.length ? path.join(support, runningArchive ?? archives.at(-1)) : undefined;
  }
  if (archive) {
    result.archive = path.basename(archive);
    await copyFile(archive, path.join(profile, path.basename(archive)));
  }
  const binary = process.env.OBSIDIAN_BINARY ?? '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
  child = spawn(binary, [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', ...(process.env.CI ? ['--no-sandbox'] : [])], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  child.on('error', error => { result.errors.push(String(error)); });
  const deadline = Date.now() + 30_000;
  let endpoint;
  while (Date.now() < deadline) {
    try {
      const [port] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n');
      endpoint = `http://127.0.0.1:${port}`;
      break;
    } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  assert.ok(endpoint, `Obsidian did not expose CDP: ${logs.slice(-2000)}`);
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  let page;
  for (let attempt = 0; attempt < 100; attempt++) {
    page = context.pages().find(candidate => candidate.url().includes('index.html'));
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(page, 'No Obsidian vault window');
  page.setDefaultTimeout(10_000);
  await page.bringToFront();
  page.on('pageerror', error => result.errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') console.error('Renderer:', message.text()); });
  await page.waitForFunction(() => typeof app !== 'undefined' && app.workspace?.layoutReady, null, { timeout: 30_000 });
  // Fresh vaults may ask whether to trust community plugins. This affects only
  // the isolated vault, and is the same consent a user gives at installation.
  const trust = page.getByRole('button', { name: /trust.*enable|turn on community plugins/i });
  if (await trust.count()) await trust.first().click();
  // A newly trusted vault opens Community plugins in a separate settings
  // window. Close that task-owned window so activeWindow is the vault.
  const status = page.locator('.writing-sessions-status');
  await status.waitFor({ timeout: 15_000 });
  if (context.pages().length === 1) await context.waitForEvent('page', { timeout: 2000 }).catch(() => {});
  for (const auxiliary of context.pages()) if (auxiliary !== page) await auxiliary.close();
  await page.bringToFront();
  await page.evaluate(() => window.focus());
  check('Plugin loads in isolated Obsidian');
  async function openNote(file) {
    const row = page.locator(`.nav-file-title[data-path="${file}"]`);
    await row.click();
    await page.locator('.markdown-source-view.mod-cm6 .cm-content').last().waitFor();
  }
  async function editor() {
    // Reloading editor extensions can clear the active-pane class until the
    // editor receives focus. This disposable workspace has one visible editor.
    const content = page.locator('.markdown-source-view.mod-cm6 .cm-content:visible').last();
    await content.click();
    await content.focus();
    return content;
  }
  async function counts(added, net) {
    await page.waitForFunction(({ added, net }) => {
      const data = app.plugins.plugins['writing-sessions']?.data;
      if (!data) return false;
      const totals = data.sessions.flatMap(session => Object.values(session.days)).reduce((a, b) => ({ added: a.added + b.added, net: a.net + b.net }), { added: 0, net: 0 });
      return totals.added === added && totals.net === net;
    }, { added, net }, { timeout: 5_000 });
  }
  await status.click();
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.keyboard.press('Escape');
  await openNote('Draft.md');
  await editor();
  await page.keyboard.type('One small habit starts with sitting down to write.');
  await counts(9, 9);
  await status.click();
  await page.screenshot({ path: path.join(screenshots, 'session-controls.png') });
  await page.keyboard.press('Escape');
  check('Start via UI and type nine words');
  await editor();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press('Backspace');
  await counts(0, 0);
  check('Ordinary deletion removes session-word credit');
  await page.keyboard.press(`${mod}+z`);
  await counts(9, 9);
  check('Undo deletion restores both retained words and net');
  const draft = () => page.evaluate(() => app.workspace.activeEditor.editor.getValue());
  // Real history grouping depends on elapsed time. A busy desktop can split
  // typing into several groups, so undo/redo all groups rather than assuming one.
  for (let step = 0; step < 50 && (await draft()).trim(); step++) {
    const previous = await draft();
    await page.keyboard.press(`${mod}+z`);
    await page.waitForFunction(previous => app.workspace.activeEditor.editor.getValue() !== previous, previous);
  }
  await counts(0, 0);
  for (let step = 0; step < 50 && (await draft()) !== 'One small habit starts with sitting down to write.'; step++) {
    const previous = await draft();
    await page.keyboard.press(`${mod}+Shift+z`);
    await page.waitForFunction(previous => app.workspace.activeEditor.editor.getValue() !== previous, previous);
  }
  await counts(9, 9);
  check('Undo and redo typing reverse and restore credit');
  await openNote('Second note.md');
  await editor();
  await page.keyboard.type('Another page counts too.');
  await counts(13, 13);
  check('Typing across notes contributes to the same session');
  await openNote('Draft.md');
  await editor();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press('Backspace');
  await counts(4, 4);
  await page.keyboard.press(`${mod}+z`);
  await counts(13, 13);
  check('Returning to a note retains session-word origins for deletion and undo');
  await openNote('Second note.md');
  await editor();
  await page.keyboard.press('End');
  // Dispatch a real clipboard event to CodeMirror. No machine clipboard access
  // or user clipboard mutation is necessary.
  await page.locator('.workspace-leaf.mod-active .cm-content').evaluate(element => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', ' Pasted words do not earn credit.');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  });
  await counts(13, 19);
  check('Editor paste grows net but earns no writing credit');
  await status.click();
  await page.getByRole('combobox').selectOption('net');
  await page.waitForFunction(() => document.querySelector('.writing-sessions-status')?.textContent.includes('19 / 100 net'));
  check('Mode toggle updates visible daily and session counters');
  await page.getByRole('combobox').selectOption('added');
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.keyboard.press('Escape');
  await editor();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.type(' More words.');
  await counts(15, 21);
  await page.waitForFunction(() => document.querySelector('.writing-sessions-status')?.textContent.includes('Session: 2'));
  check('Daily total combines sessions while current session starts from zero');
  // Let the production save queue settle, then inspect the actual saved file.
  let saved;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { saved = JSON.parse(await readFile(path.join(pluginDir, 'data.json'), 'utf8')); } catch { /* Wait for initial save. */ }
    if (saved?.sessions.length === 2 && Object.values(saved.sessions[1].days).some(counts => counts.added === 2)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(saved.sessions.length, 2);
  assert.equal(saved.sessions[1].endedAt, null);
  const ownershipInputs = await page.evaluate(async () => {
    const data = app.plugins.plugins['writing-sessions'].data;
    return Promise.all(Object.entries(data.ownership).map(async ([path, record]) => ({
      path, digest: record.digest, marks: record.marks.length,
      disk: await app.vault.read(app.vault.getAbstractFileByPath(path)),
      editor: app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === path)?.view.editor?.getValue(),
    })));
  });
  console.log('Before reload ownership:', JSON.stringify(ownershipInputs.map(({ path, digest, marks, disk, editor }) => ({
    path, marks, diskMatches: createHash('sha256').update(disk.replace(/\r\n?/g, '\n')).digest('hex') === digest,
    editorMatches: editor === undefined ? null : createHash('sha256').update(editor.replace(/\r\n?/g, '\n')).digest('hex') === digest,
  }))));
  // A plugin lifecycle reload exercises persisted data without terminating the
  // host before asynchronous unload has completed.
  await page.evaluate(async () => {
    await app.plugins.disablePlugin('writing-sessions');
    await app.plugins.enablePlugin('writing-sessions');
  });
  await counts(15, 21);
  console.log('After reload ownership:', await page.evaluate(() => Object.entries(app.plugins.plugins['writing-sessions'].data.ownership).map(([path, record]) => ({ path, marks: record.marks.length }))));
  await openNote('Second note.md');
  await editor();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press('Backspace');
  await counts(13, 9);
  await page.keyboard.press(`${mod}+z`);
  await counts(15, 21);
  check('Ownership survives reload and subtracts only active-session words');
  await status.click();
  await page.getByRole('button', { name: 'End session', exact: true }).waitFor();
  check('Saved counts, history, and unfinished session survive plugin reload');
  await page.screenshot({ path: path.join(screenshots, 'session-history.png') });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(screenshots, 'writing-counter.png') });
  await page.evaluate(() => app.changeTheme('obsidian'));
  await page.waitForFunction(() => document.body.classList.contains('theme-dark'));
  await status.click();
  await page.screenshot({ path: path.join(screenshots, 'session-dark.png') });
  await page.keyboard.press('Escape');
  // Slow only the external storage boundary, then reload immediately after
  // real typing. The incoming plugin must drain its predecessor's queued saves.
  await page.evaluate(() => {
    const plugin = app.plugins.plugins['writing-sessions'];
    const save = plugin.saveData.bind(plugin);
    plugin.saveData = async data => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return save(data);
    };
  });
  await editor();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.type(' Save safely.');
  await page.evaluate(async () => {
    await app.plugins.disablePlugin('writing-sessions');
    await app.plugins.enablePlugin('writing-sessions');
  });
  await counts(17, 23);
  const recovered = JSON.parse(await readFile(path.join(pluginDir, 'data.json'), 'utf8'));
  const recoveredAdded = recovered.sessions.flatMap(session => Object.values(session.days)).reduce((sum, counts) => sum + counts.added, 0);
  assert.equal(recoveredAdded, 17);
  check('Immediate reload drains slow pending saves without losing progress');
  assert.deepEqual(result.errors, []);
  check('No uncaught renderer errors');
} catch (error) {
  const failedPage = browser?.contexts()[0]?.pages().find(page => page.url().includes('index.html'));
  if (failedPage) {
    console.error((await failedPage.locator('body').innerText()).slice(0, 2500));
    await failedPage.screenshot({ path: path.join(root, 'release/failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close().catch(() => {});
  if (child?.pid && child.exitCode === null) {
    const signal = value => {
      try { process.kill(-child.pid, value); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    signal('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) signal('SIGKILL');
  }
  if (process.platform === 'darwin') execFileSync('/usr/bin/trash', [scratch]);
  else { const { rm } = await import('node:fs/promises'); await rm(scratch, { recursive: true, force: true }); }
  await writeFile(path.join(root, 'release/smoke-result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('Stopped isolated Obsidian and removed its profile/vault. Screenshots retained.');
}
