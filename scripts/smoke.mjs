import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { readState, connectInstance } from './control-writing-sessions.mjs';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const instance = await readState();
const { pluginDir, evidence } = instance;
const screenshots = path.join(evidence, 'screenshots');
await mkdir(screenshots, { recursive: true });
let browser;
let tracing;
const result = { archive: instance.archive ?? null, checks: [], errors: [], success: false };
const check = description => { result.checks.push(description); console.log(`PASS ${description}`); };
try {
  const connected = await connectInstance(instance);
  browser = connected.browser;
  const { page, context } = connected;
  tracing = context.tracing;
  await tracing.start({ screenshots: true, snapshots: true });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.bringToFront();
  await page.evaluate(() => window.focus());
  page.on('pageerror', error => result.errors.push(String(error)));
  const status = page.locator('.writing-sessions-status');
  check('Plugin loads in isolated Obsidian');
  async function openNote(file) {
    // A nav click can leave the previous editor visible during async loading.
    // Await the public file-open operation before sending real keystrokes.
    await page.evaluate(async path => {
      await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(path));
    }, file);
    await page.locator('.markdown-source-view.mod-cm6 .cm-content:visible').last().waitFor();
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
  async function palette(name, prefix = 'Writing Sessions: ') {
    await page.keyboard.press(`${mod}+p`);
    await page.locator('.prompt-input').fill(`${prefix}${name}`);
    let item = page.locator('.suggestion-item').filter({ hasText: name });
    if (prefix) item = item.filter({ hasText: 'Writing Sessions' });
    await item.first().click();
  }
  // Settings are a separate user entry point: drive it before counting fixtures.
  await palette('Open settings', '');
  let settingsPage;
  for (let attempt = 0; attempt < 50; attempt++) {
    for (const candidate of context.pages()) {
      if (await candidate.locator('.vertical-tab-nav-item').filter({ hasText: /^Writing Sessions$/ }).count()) settingsPage = candidate;
    }
    if (settingsPage) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(settingsPage, 'No Writing Sessions settings tab in owned windows');
  await settingsPage.bringToFront();
  await settingsPage.evaluate(() => window.focus());
  await settingsPage.locator('.vertical-tab-nav-item').filter({ hasText: /^Writing Sessions$/ }).click();
  const cue = settingsPage.getByRole('textbox', { name: 'Daily word cue', exact: true });
  await cue.click();
  await cue.press(`${mod}+a`);
  await cue.pressSequentially('12', { delay: 100 });
  assert.equal(await cue.inputValue(), '12');
  await settingsPage.getByRole('combobox', { name: 'Counting mode', exact: true }).selectOption('net');
  await settingsPage.locator('[aria-label="Celebrate daily goal"]').click();
  await settingsPage.screenshot({ path: path.join(screenshots, 'settings.png') });
  let settingsSaved;
  for (let attempt = 0; attempt < 50; attempt++) {
    settingsSaved = JSON.parse(await readFile(path.join(pluginDir, 'data.json'), 'utf8'));
    if (settingsSaved.target === 12 && settingsSaved.mode === 'net' && settingsSaved.celebrateGoal === false) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(settingsSaved.target, 12);
  assert.equal(settingsSaved.mode, 'net');
  assert.equal(settingsSaved.celebrateGoal, false);
  await writeFile(path.join(evidence, 'settings-data.json'), JSON.stringify(settingsSaved, null, 2));
  await cue.click();
  await cue.press(`${mod}+a`);
  await cue.pressSequentially('10', { delay: 100 });
  assert.equal(await cue.inputValue(), '10');
  await settingsPage.getByRole('combobox', { name: 'Counting mode', exact: true }).selectOption('added');
  await settingsPage.locator('[aria-label="Celebrate daily goal"]').click();
  if (settingsPage === page) await page.keyboard.press('Escape');
  else await settingsPage.close();
  await page.bringToFront();
  check('Settings UI changes cue, mode, and celebration and persists all three values');
  await palette('Open session controls and history');
  await page.getByRole('button', { name: 'Start session', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await palette('Start writing session');
  await palette('Pause writing session');
  await page.waitForFunction(() => document.querySelector('.writing-sessions-status')?.textContent.includes('Paused: 0'));
  await palette('Resume writing session');
  await palette('End writing session');
  await palette('Toggle words added / net change');
  await page.waitForFunction(() => document.querySelector('.writing-sessions-status')?.textContent.includes('/ 10 net'));
  await palette('Toggle words added / net change');
  check('Command palette opens controls, starts, pauses, resumes, ends, and toggles mode');
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
  await page.waitForFunction(() => document.querySelector('.writing-sessions-status')?.textContent.includes('Daily goal reached!'));
  assert.equal(await status.evaluate(el => getComputedStyle(el).animationName), 'writing-sessions-goal');
  assert.match(await page.locator('.writing-sessions-announcement').innerText(), /Daily goal reached/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await status.evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.screenshot({ path: path.join(screenshots, 'daily-goal.png') });
  await page.waitForFunction(() => !document.querySelector('.writing-sessions-status')?.textContent.includes('Daily goal reached!'));
  check('Daily goal celebrates with motion, text, and a Reduce Motion alternative');
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
  await page.waitForFunction(() => document.querySelector('.writing-sessions-status')?.textContent.includes('19 / 10 net'));
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
    if (saved?.sessions.length === 3 && Object.values(saved.sessions[2].days).some(counts => counts.added === 2)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(saved.sessions.length, 3);
  assert.equal(saved.sessions[2].endedAt, null);
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
  assert.equal(await page.evaluate(() => app.plugins.plugins['writing-sessions'].data.celebratedDays.length), 1);
  assert.equal(await status.evaluate(el => el.classList.contains('writing-sessions-celebrate')), false);
  check('Goal celebration does not repeat after undo, rewriting, sessions, and reloads');
  const sessionBeforePause = await page.evaluate(() => app.plugins.plugins['writing-sessions'].data.sessions.at(-1).id);
  await status.click();
  await page.getByRole('button', { name: 'Pause session', exact: true }).click();
  await page.getByRole('button', { name: 'Resume session', exact: true }).waitFor();
  await page.screenshot({ path: path.join(screenshots, 'session-paused-dark.png') });
  await page.evaluate(() => app.changeTheme('moonstone'));
  await page.waitForFunction(() => document.body.classList.contains('theme-light'));
  await page.screenshot({ path: path.join(screenshots, 'session-paused.png') });
  await page.keyboard.press('Escape');
  await openNote('Paused note.md');
  await editor();
  await page.keyboard.type('These words are not counted.');
  await counts(17, 23);
  await page.keyboard.press(`${mod}+z`);
  await counts(17, 23);
  await page.keyboard.press(`${mod}+Shift+z`);
  await counts(17, 23);
  await page.evaluate(async () => {
    await app.plugins.disablePlugin('writing-sessions');
    await app.plugins.enablePlugin('writing-sessions');
  });
  await page.waitForFunction(() => document.querySelector('.writing-sessions-status')?.textContent.includes('Paused: 4'));
  await counts(17, 23);
  const commandAvailable = id => page.evaluate(id => app.commands.commands[`writing-sessions:${id}`].checkCallback(true), id);
  assert.equal(await commandAvailable('start-session'), false);
  assert.equal(await commandAvailable('pause-session'), false);
  assert.equal(await commandAvailable('resume-session'), true);
  assert.equal(await commandAvailable('end-session'), true);
  await status.click();
  await page.getByRole('button', { name: 'Resume session', exact: true }).click();
  await page.getByRole('button', { name: 'Pause session', exact: true }).waitFor();
  await page.screenshot({ path: path.join(screenshots, 'session-resumed.png') });
  await page.keyboard.press('Escape');
  await editor();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.type(' Count again.');
  await counts(19, 25);
  assert.equal(await page.evaluate(() => app.plugins.plugins['writing-sessions'].data.sessions.at(-1).id), sessionBeforePause);
  // Remove only the resumed writing to keep the later cutoff checks independent.
  for (let char = 0; char < ' Count again.'.length; char++) await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Backspace');
  await counts(17, 23);
  await page.evaluate(() => app.commands.executeCommandById('writing-sessions:pause-session'));
  assert.equal(await commandAvailable('resume-session'), true);
  await page.evaluate(() => app.commands.executeCommandById('writing-sessions:resume-session'));
  assert.equal(await commandAvailable('pause-session'), true);
  check('Pause ignores typing and its undo/redo, survives reload, and resumes the same session via UI and commands');
  // Move only Date in this disposable renderer; timers keep running normally.
  const cutoff = await page.evaluate(() => {
    const date = new Date();
    if (date.getHours() >= 4) date.setDate(date.getDate() + 1);
    date.setHours(4, 0, 0, 0);
    return date.getTime();
  });
  await page.clock.setFixedTime(cutoff - 250);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await status.click();
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.keyboard.press('Escape');
  await editor();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.type(' Before cutoff.');
  await counts(19, 25);
  await page.evaluate(() => app.commands.executeCommandById('writing-sessions:pause-session'));
  await page.clock.setFixedTime(cutoff);
  await page.waitForFunction(() => {
    const plugin = app.plugins.plugins['writing-sessions'];
    return plugin.data.sessions.every(session => session.endedAt !== null) &&
      document.querySelector('.writing-sessions-status')?.textContent.includes('Start writing · Today: 0 / 10');
  });
  assert.equal(await page.evaluate(() => app.plugins.plugins['writing-sessions'].data.sessions.at(-1).endedAt), new Date(cutoff).toISOString());
  await page.keyboard.type(' After cutoff.');
  await counts(19, 25);
  check('04:00 timer ends a paused session, resets today, and stops counting until manual start');
  await status.click();
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.keyboard.press('Escape');
  await editor();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.type(' Fresh session.');
  await counts(21, 27);
  await page.waitForFunction(() => document.querySelector('.writing-sessions-status')?.textContent.includes('Session: 2 · Today: 2 / 10'));
  const nextCutoff = await page.evaluate(() => {
    const date = new Date(); date.setDate(date.getDate() + 1); date.setHours(4, 0, 0, 0); return date.getTime();
  });
  await page.clock.setFixedTime(nextCutoff + 3_600_000);
  await page.keyboard.type(' Wake edit.');
  await counts(21, 27);
  assert.equal(await page.evaluate(() => app.plugins.plugins['writing-sessions'].data.sessions.at(-1).endedAt), new Date(nextCutoff).toISOString());
  check('First edit after a missed cutoff expires the session before granting credit');
  await status.click();
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.evaluate(() => app.commands.executeCommandById('writing-sessions:pause-session'));
  const followingCutoff = await page.evaluate(() => {
    const date = new Date(); date.setDate(date.getDate() + 1); date.setHours(4, 0, 0, 0); return date.getTime();
  });
  await page.clock.setFixedTime(followingCutoff + 3_600_000);
  await page.evaluate(async () => {
    await app.plugins.disablePlugin('writing-sessions');
    await app.plugins.enablePlugin('writing-sessions');
  });
  await counts(21, 27);
  assert.equal(await page.evaluate(() => app.plugins.plugins['writing-sessions'].data.sessions.at(-1).endedAt), new Date(followingCutoff).toISOString());
  await page.waitForFunction(() => document.querySelector('.writing-sessions-status')?.textContent.includes('Start writing · Today: 0 / 10'));
  check('Reload after a missed cutoff closes the saved session at 04:00 and keeps history');
  let finalSaved;
  for (let attempt = 0; attempt < 50; attempt++) {
    finalSaved = JSON.parse(await readFile(path.join(pluginDir, 'data.json'), 'utf8'));
    if (finalSaved.sessions.at(-1).endedAt === new Date(followingCutoff).toISOString()) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(finalSaved.sessions.at(-1).endedAt, new Date(followingCutoff).toISOString());
  await writeFile(path.join(evidence, 'data.json'), JSON.stringify(finalSaved, null, 2));
  assert.deepEqual(result.errors, []);
  check('No uncaught renderer errors');
  result.success = true;
} catch (error) {
  const failedPage = browser?.contexts()[0]?.pages().find(page => page.url().includes('index.html'));
  if (failedPage) {
    console.error((await failedPage.locator('body').innerText()).slice(0, 2500));
    await writeFile(path.join(evidence, 'failure.aria.txt'), await failedPage.locator('body').ariaSnapshot());
    await failedPage.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  if (browser) {
    const page = browser.contexts()[0]?.pages().find(page => page.url().includes('index.html'));
    if (page) {
      await writeFile(path.join(evidence, 'notes.json'), JSON.stringify(await page.evaluate(async () => {
        const files = app.vault.getMarkdownFiles();
        return Promise.all(files.map(async file => ({ path: file.path, text: await app.vault.read(file) })));
      }), null, 2)).catch(() => {});
    }
    await copyFile(path.join(pluginDir, 'data.json'), path.join(evidence, 'data.json')).catch(() => {});
  }
  await tracing?.stop({ path: path.join(evidence, 'trace.zip') }).catch(() => {});
  await browser?.close().catch(() => {});
  await writeFile(path.join(evidence, 'smoke-result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`Evidence retained: ${evidence}. Run ./scripts/control-writing-sessions stop to clean up.`);
}
