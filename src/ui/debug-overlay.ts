/** Top-left stats readout plus the probe button and result panel. Plain DOM; replaced by the real HUD later. */
export class DebugOverlay {
  private readonly stats: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly probeButton: HTMLButtonElement;
  private readonly surveyButton: HTMLButtonElement;
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

    const row = document.createElement('div');
    this.probeButton = document.createElement('button');
    this.probeButton.className = 'button';
    this.probeButton.textContent = 'Run GPU probe';
    this.surveyButton = document.createElement('button');
    this.surveyButton.className = 'button';
    this.surveyButton.textContent = 'Perf survey';
    this.surveyButton.style.marginLeft = '8px';
    this.copyButton = document.createElement('button');
    this.copyButton.className = 'button';
    this.copyButton.textContent = 'Copy JSON';
    this.copyButton.hidden = true;
    this.copyButton.style.marginLeft = '8px';
    row.append(this.probeButton, this.surveyButton, this.copyButton);

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

  setStats(text: string): void {
    this.text = text;
    this.render();
  }

  private render(): void {
    const lines = this.text.split('\n');
    this.stats.textContent = this.expanded || lines.length < 3 ? this.text : `${lines[0]}  |  ${lines[2]}`;
  }

  onProbe(handler: () => void): void {
    this.probeButton.addEventListener('click', handler);
  }

  onSurvey(handler: () => void): void {
    this.surveyButton.addEventListener('click', handler);
  }

  setSurveyRunning(running: boolean): void {
    this.surveyButton.disabled = running;
    this.surveyButton.textContent = running ? 'Surveying...' : 'Perf survey';
  }

  setProbeRunning(running: boolean): void {
    this.probeButton.disabled = running;
    this.probeButton.textContent = running ? 'Probing...' : 'Run GPU probe';
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
