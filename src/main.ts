import { Modal, Notice, Plugin, PluginSettingTab, Setting, type App } from 'obsidian';
import { activeSession, applyCredit, dailyCounts, initialData, parseData, sessionCounts, writingDay, type Data, type Mode } from './model';
import { trackingExtension } from './tracking';
import { writeQueue } from './storage';

export default class WritingSessions extends Plugin {
  data: Data = initialData();
  private status!: HTMLButtonElement;
  private listeners = new Set<() => void>();
  private controls?: SessionModal;
  private saveFailed = false;

  async onload(): Promise<void> {
    await writeQueue(this.app).pending;
    try { this.data = parseData(await this.loadData()); }
    catch (error) { new Notice(String(error), 0); throw error; }
    this.status = this.addStatusBarItem().createEl('button', { cls: 'writing-sessions-status' });
    this.registerDomEvent(this.status, 'click', () => this.openControls());
    this.addCommand({ id: 'start-session', name: 'Start writing session', checkCallback: checking => {
      if (activeSession(this.data)) return false;
      if (!checking) this.startSession();
      return true;
    } });
    this.addCommand({ id: 'end-session', name: 'End writing session', checkCallback: checking => {
      if (!activeSession(this.data)) return false;
      if (!checking) this.endSession();
      return true;
    } });
    this.addCommand({ id: 'open-controls', name: 'Open session controls and history', callback: () => this.openControls() });
    this.addCommand({ id: 'toggle-counting-mode', name: 'Toggle words added / net change', callback: () => {
      this.setMode(this.data.mode === 'added' ? 'net' : 'added');
    } });
    this.registerEditorExtension(trackingExtension(() => {
      const session = activeSession(this.data);
      return session ? { sessionId: session.id, day: writingDay(new Date()) } : undefined;
    }, credit => {
      if (!credit.added && !credit.net) return;
      applyCredit(this.data, credit);
      this.changed();
    }));
    this.registerInterval(window.setInterval(() => this.refresh(), 30_000));
    this.addSettingTab(new WritingSettings(this.app, this));
    this.refresh();
  }

  onunload(): void { this.controls?.close(); }

  startSession(): void {
    if (activeSession(this.data)) return;
    this.data.sessions.push({ id: crypto.randomUUID(), startedAt: new Date().toISOString(), endedAt: null, days: {} });
    this.changed();
  }
  endSession(): void {
    const session = activeSession(this.data);
    if (!session) return;
    session.endedAt = new Date().toISOString();
    this.changed();
  }
  setMode(mode: Mode): void { this.data.mode = mode; this.changed(); }
  setTarget(target: number): void { this.data.target = target; this.changed(); }
  openControls(): void {
    this.controls?.close();
    this.controls = new SessionModal(this.app, this);
    this.controls.open();
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private changed(): void {
    this.refresh();
    // Snapshot at the mutation boundary; serialize writes so a slower earlier
    // save can never overwrite a newer session or count.
    const snapshot: Data = structuredClone(this.data);
    const queue = writeQueue(this.app);
    queue.pending = queue.pending.then(async () => {
      await this.saveData(snapshot);
      if (this.saveFailed) { this.saveFailed = false; this.refresh(); }
    }).catch((error: unknown) => {
      if (!this.saveFailed) new Notice('Writing Sessions could not save progress. Check vault permissions and free disk space.', 0);
      this.saveFailed = true;
      console.error('Writing Sessions: save failed', error);
      this.refresh();
    });
  }
  private refresh(): void {
    const mode = this.data.mode;
    const session = activeSession(this.data);
    const today = dailyCounts(this.data, writingDay(new Date()))[mode];
    const label = mode === 'added' ? 'words added' : 'net words';
    this.status.setText(`${session ? `Session: ${sessionCounts(session)[mode]}` : 'Start writing'} · Today: ${today} / ${this.data.target}${mode === 'net' ? ' net' : ''}${this.saveFailed ? ' · Not saved' : ''}`);
    this.status.setAttribute('aria-label', `Writing Sessions. ${label}. ${this.status.textContent}. Open controls and history.`);
    this.status.title = `${label}. Writing day resets at 04:00. Click for controls and history.`;
    for (const listener of this.listeners) listener();
  }
}

class WritingSettings extends PluginSettingTab {
  constructor(app: App, private tracker: WritingSessions) { super(app, tracker); }
  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl).setName('Daily word cue').setDesc('A small reason to sit down and write. Progress continues beyond this number.')
      .addText(input => {
        input.inputEl.setAttribute('aria-label', 'Daily word cue');
        input.setValue(String(this.tracker.data.target)).onChange(value => {
        const target = Number(value);
        if (Number.isSafeInteger(target) && target > 0) this.tracker.setTarget(target);
        });
      });
    new Setting(this.containerEl).setName('Counting mode').setDesc('Both counts are saved. Switching changes the display, including history.')
      .addDropdown(input => {
        input.selectEl.setAttribute('aria-label', 'Counting mode');
        input.addOption('added', 'Words added').addOption('net', 'Net change').setValue(this.tracker.data.mode)
          .onChange(value => this.tracker.setMode(value as Mode));
      });
    this.containerEl.createEl('p', { text: 'Words added excludes paste, drag and drop, and background changes. Net change includes manual pastes and deletions. The writing day starts at 04:00 local time.' });
  }
}

class SessionModal extends Modal {
  private unsubscribe?: () => void;
  constructor(app: App, private tracker: WritingSessions) { super(app); }
  onOpen(): void {
    this.setTitle('Writing sessions');
    this.contentEl.addClass('writing-sessions-modal');
    const summary = this.contentEl.createDiv({ cls: 'writing-sessions-summary' });
    const action = new Setting(this.contentEl).setName('Current session');
    action.addButton(button => {
      button.setCta().onClick(() => activeSession(this.tracker.data) ? this.tracker.endSession() : this.tracker.startSession());
      this.subscribe(() => button.setButtonText(activeSession(this.tracker.data) ? 'End session' : 'Start session'));
    });
    new Setting(this.contentEl).setName('Show').addDropdown(input => {
      input.selectEl.setAttribute('aria-label', 'Counting mode');
      input.addOption('added', 'Words added').addOption('net', 'Net change').setValue(this.tracker.data.mode)
        .onChange(value => this.tracker.setMode(value as Mode));
      this.subscribe(() => input.setValue(this.tracker.data.mode));
    });
    this.contentEl.createEl('p', { cls: 'writing-sessions-hint', text: 'Words added counts typing, including words later deleted. Paste and moving text earn no extra credit. Net change shows manual document growth, including pastes. Undo reverses credit; redo restores it.' });
    const history = this.contentEl.createDiv({ cls: 'writing-sessions-history' });
    this.subscribe(() => {
      const { data } = this.tracker;
      const session = activeSession(data);
      const day = writingDay(new Date());
      summary.empty();
      const today = dailyCounts(data, day)[data.mode];
      summary.createEl('p', { cls: 'writing-sessions-today', text: `${today} / ${data.target} ${data.mode === 'added' ? 'words added' : 'net words'} today` });
      const progress = summary.createEl('progress', { attr: { max: String(data.target), value: String(Math.max(0, today)), 'aria-label': 'Daily writing progress' } });
      progress.setAttribute('aria-valuetext', `${today} of ${data.target} words`);
      summary.createEl('p', { text: session ? `This session: ${sessionCounts(session)[data.mode]} words · Started ${new Date(session.startedAt).toLocaleString()}` : 'Start a session when you sit down to write.' });
      summary.createEl('small', { text: `Writing day ${day} · Resets at 04:00 local time` });
      history.empty();
      history.createEl('h3', { text: 'Daily history' });
      const days = [...new Set(data.sessions.flatMap(item => Object.keys(item.days)))].sort().reverse();
      if (!days.length) history.createEl('p', { text: 'Your writing will appear here after you start a session.' });
      for (const date of days) {
        const counts = dailyCounts(data, date);
        history.createEl('p', { text: `${date} · ${counts[data.mode]} ${data.mode === 'added' ? 'words added' : 'net words'}` });
      }
      history.createEl('h3', { text: 'Sessions' });
      for (const item of [...data.sessions].reverse()) {
        const row = history.createDiv({ cls: 'writing-sessions-history-row' });
        row.createEl('strong', { text: `${sessionCounts(item)[data.mode]} ${data.mode === 'added' ? 'words added' : 'net words'}` });
        row.createEl('span', { text: new Date(item.startedAt).toLocaleString() });
        row.createEl('small', { text: item.endedAt ? `Ended ${new Date(item.endedAt).toLocaleString()}` : 'In progress' });
      }
    });
  }
  private subscribe(listener: () => void): void {
    const previous = this.unsubscribe;
    const remove = this.tracker.subscribe(listener);
    this.unsubscribe = () => { previous?.(); remove(); };
    listener();
  }
  onClose(): void { this.unsubscribe?.(); this.contentEl.empty(); }
}
