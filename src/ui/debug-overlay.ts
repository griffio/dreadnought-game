/**
 * Top-left stats readout and the panel the GPU probe and the Perf survey write their log and report into. Both are started by URL
 * (`?probe`, `?survey=1`, `?survey=ship`, `?survey=sea`): there are no buttons for them on the screen.
 */
export class DebugOverlay {
  private readonly stats: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly copyButton: HTMLButtonElement;
  private lines: string[] = [];
  private json = '';
  private text = '';
  private expanded: boolean;

  /** `expanded` shows the full stats; otherwise only the headline and the frame rate (click the readout to toggle). */
  constructor(root: HTMLElement, expanded = false) {
    this.expanded = expanded;
    this.stats = document.createElement('div');
    this.stats.className = 'hud';
    this.stats.style.pointerEvents = 'auto';
    this.stats.addEventListener('click', () => {
      this.expanded = !this.expanded;
      this.render();
    });

    // The only button: it appears with a report, to copy it.
    const row = document.createElement('div');
    this.copyButton = document.createElement('button');
    this.copyButton.className = 'button';
    this.copyButton.textContent = 'Copy JSON';
    this.copyButton.hidden = true;
    row.append(this.copyButton);

    this.panel = document.createElement('div');
    this.panel.className = 'panel probe-output';
    this.panel.hidden = true;

    root.append(this.stats, row, this.panel);

    this.copyButton.addEventListener('click', () => {
      void navigator.clipboard?.writeText(this.json).then(
        () => (this.copyButton.textContent = 'Copied'),
        () => (this.copyButton.textContent = 'Copy failed: select text instead'),
      );
    });
  }

  /** Show or hide the readout: it is a developer's instrument, on the screen only with `?debug=1`. */
  showStats(show: boolean): void {
    this.stats.style.display = show ? '' : 'none';
    if (show) this.render();
  }

  setStats(text: string): void {
    this.text = text;
    if (this.stats.style.display !== 'none') this.render();
  }

  private render(): void {
    const lines = this.text.split('\n');
    this.stats.textContent = this.expanded || lines.length < 3 ? this.text : `${lines[0]}  |  ${lines[2]}`;
  }

  resetProbeLog(): void {
    this.lines = [];
    this.panel.hidden = false;
    this.panel.textContent = '';
    this.copyButton.hidden = true;
    this.copyButton.textContent = 'Copy JSON';
  }

  appendProbeLog(line: string): void {
    this.lines.push(line);
    this.panel.textContent = this.lines.join('\n');
    this.panel.scrollTop = this.panel.scrollHeight;
  }

  showProbeJson(json: string): void {
    this.json = json;
    this.copyButton.hidden = false;
    this.appendProbeLog(`\n--- report ---\n${json}`);
  }
}
