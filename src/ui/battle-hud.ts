import type { LogMessage } from '../app/message-log';
import type { Outcome, Threat } from '../app/game';
import type { ShipDamage } from '../sim/damage/ship-damage';

const KNOT = 0.514444;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.append(e);
  return e;
}

export interface BattleHudInput {
  now: number;
  messages: readonly LogMessage[];
  /** The player's ship. */
  own: { name: string; damage: ShipDamage; speed: number; maxSpeedKn: number };
  panelOpen: boolean;
  outcome: Outcome | null;
  /** Torpedo wakes the bridge has seen running at the ship. */
  threats?: readonly Threat[];
  /** The Admiralty's marks for the sortie, once it is over: the prestige earned, each line of it, and the total now in hand. */
  prestige?: { earned: number; total: number; lines: readonly { label: string; fraction: number }[]; base: number } | null;
  /** The state of the shore, in the Narrows: batteries silenced, the keel, mines found, the aircraft. */
  shore?: { forts: number; silenced: number; aground: boolean; mines: number; spotter: { state: string; fuel: number } | null } | null;
  /** The 12-pounders' target, when they have one. */
  secondary?: { name: string; range: number; guns: number; ready: number; firing: boolean; battery?: string } | null;
}

const STATE_TEXT: Record<string, string> = { ok: 'READY', jammed: 'JAMMED', destroyed: 'WRECKED', 'no-ammo': 'NO AMMO' };

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

/**
 * What the fight looks like to the captain: the log of events, chips for whatever is going wrong aboard, a schematic of
 * the ship's compartments and turrets (H), and the result when it is over.
 */
export class BattleHud {
  readonly element: HTMLDivElement;
  private readonly log: HTMLDivElement;
  private readonly chips: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly panelTitle: HTMLDivElement;
  private readonly hull: HTMLDivElement;
  private readonly turrets: HTMLDivElement;
  private readonly facts: HTMLDivElement;
  private readonly result: HTMLDivElement;
  private readonly resultTitle: HTMLDivElement;
  private readonly resultHow: HTMLDivElement;
  private readonly resultStats: HTMLDivElement;
  private readonly resultPrestige: HTMLDivElement;
  private readonly cells = new Map<string, { box: HTMLDivElement; water: HTMLElement; fire: HTMLElement }>();
  private readonly chipEls = new Map<string, HTMLDivElement>();
  private readonly lineEls: HTMLDivElement[] = [];
  private dismissed = false;
  private readonly onPanelToggle: () => void;

  constructor(root: HTMLElement, onAgain: () => void, onPanelToggle: () => void, onPort?: () => void, onReplay?: () => void) {
    this.onPanelToggle = onPanelToggle;
    this.element = el('div', 'battle');
    const top = el('div', 'btop', this.element);
    this.log = el('div', 'mlog', top);
    this.chips = el('div', 'alerts', top);

    this.panel = el('div', 'dpanel', this.element);
    this.panelTitle = el('div', 'dtitle', this.panel);
    this.hull = el('div', 'dhull', this.panel);
    this.turrets = el('div', 'dturrets', this.panel);
    this.facts = el('div', 'dfacts', this.panel);
    el('div', 'dhint', this.panel, 'H or tap here to close');
    this.panel.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onPanelToggle();
    });

    this.result = el('div', 'result', this.element);
    this.resultTitle = el('div', 'rtitle', this.result);
    this.resultHow = el('div', 'rhow', this.result);
    this.resultStats = el('div', 'rstats', this.result);
    this.resultPrestige = el('div', 'rprestige', this.result);
    this.resultPrestige.hidden = true;
    const buttons = el('div', 'rbuttons', this.result);
    const again = el('button', 'button', buttons, 'Fight again');
    again.addEventListener('click', onAgain);
    if (onPort) {
      const port = el('button', 'button', buttons, 'Return to port');
      port.addEventListener('click', onPort);
    }
    if (onReplay) {
      const replay = el('button', 'button', buttons, 'Watch replay');
      replay.addEventListener('click', onReplay);
    }
    const keep = el('button', 'button ghost', buttons, 'Keep watching');
    keep.addEventListener('click', () => {
      this.dismissed = true;
    });
    this.result.hidden = true;
    this.panel.hidden = true;
    root.append(this.element);
  }

  update(input: BattleHudInput): void {
    this.renderLog(input);
    this.renderChips(input);
    this.panel.hidden = !input.panelOpen;
    if (input.panelOpen) this.renderPanel(input);
    this.renderResult(input);
  }

  private renderLog({ messages, now }: BattleHudInput): void {
    while (this.lineEls.length < 7) this.lineEls.push(el('div', 'mline', this.log));
    const n = this.lineEls.length;
    // Oldest at the top, newest at the bottom.
    this.lineEls.forEach((line, i) => {
      const m = messages[messages.length - n + i];
      if (!m) {
        line.textContent = '';
        line.dataset.tone = '';
        return;
      }
      line.textContent = m.text;
      line.dataset.tone = m.tone;
      line.style.opacity = String(Math.min(1, Math.max(0.2, 1 - Math.max(now - m.at - 9, 0) / 5)));
    });
  }

  private renderChips({ own, threats = [], secondary = null, shore = null }: BattleHudInput): void {
    const d = own.damage;
    const s = d.summary();
    const chips: { key: string; text: string; tone: 'warn' | 'alert' | 'ok'; dim?: boolean }[] = [];
    if (s.floodedT > 40) chips.push({ key: 'flood', text: `FLOODING ${Math.round(s.floodedT)} t`, tone: s.floodedT > s.reserveT * 0.3 ? 'alert' : 'warn' });
    if (Math.abs(s.listDeg) > 1.5) chips.push({ key: 'list', text: `LIST ${Math.abs(s.listDeg).toFixed(0)}° ${s.listDeg > 0 ? 'STBD' : 'PORT'}`, tone: Math.abs(s.listDeg) > 8 ? 'alert' : 'warn' });
    if (s.fires > 0) chips.push({ key: 'fire', text: `FIRE x${s.fires}`, tone: 'alert' });
    if (s.power < 0.95) chips.push({ key: 'power', text: `ENGINES ${Math.round(s.power * 100)}%`, tone: s.power < 0.5 ? 'alert' : 'warn' });
    if (s.steeringFailed) chips.push({ key: 'rudder', text: 'RUDDER JAMMED', tone: 'alert' });
    if (s.fireControl < 0.9) chips.push({ key: 'fc', text: `FIRE CONTROL ${Math.round(s.fireControl * 100)}%`, tone: s.fireControl < 0.5 ? 'alert' : 'warn' });
    if (s.turretsLost > 0) chips.push({ key: 'turrets', text: `TURRETS OUT ${s.turretsLost}/${s.turretsTotal}`, tone: 'alert' });
    if (shore) {
      chips.push({ key: 'forts', text: `BATTERIES SILENCED ${shore.silenced}/${shore.forts}`, tone: shore.silenced === shore.forts ? 'ok' : 'warn' });
      if (shore.aground) chips.push({ key: 'aground', text: 'AGROUND - GO ASTERN', tone: 'alert' });
      if (shore.mines > 0) chips.push({ key: 'mines', text: `MINES MARKED ${shore.mines}`, tone: 'warn', dim: true });
      const sp = shore.spotter;
      if (sp) {
        const m = Math.floor(sp.fuel / 60);
        const text =
          sp.state === 'flying'
            ? `SPOTTER UP - FUEL ${m}:${String(Math.floor(sp.fuel % 60)).padStart(2, '0')}`
            : sp.state === 'launching'
              ? 'SPOTTER LAUNCHING'
              : sp.state === 'landing'
                ? 'SPOTTER LANDING'
                : 'SPOTTER ON DECK (K)';
        chips.push({ key: 'spotter', text, tone: sp.state === 'flying' ? 'ok' : 'warn', dim: sp.state === 'deck' });
      }
    }
    if (secondary) {
      chips.push({
        key: 'secondary',
        text: `${secondary.battery ?? '12-PDRS'} ${secondary.firing ? 'FIRING ON' : 'LAYING ON'} ${secondary.name.toUpperCase()} · ${Math.round(secondary.range / 10) * 10} m · ${secondary.ready}/${secondary.guns}`,
        tone: 'ok',
      });
    }
    for (const t of threats.slice(0, 4)) {
      const rel = (t.relative * 180) / Math.PI;
      const side = Math.abs(rel) < 8 ? 'AHEAD' : Math.abs(rel) > 172 ? 'ASTERN' : rel > 0 ? `STBD ${Math.round(rel)}°` : `PORT ${Math.round(-rel)}°`;
      const when = t.eta === null ? 'PASSING CLEAR' : `${Math.round(t.eta)} s`;
      chips.push({
        key: `torpedo-${t.id}`,
        text: `TORPEDO ${side} · ${Math.round(t.range / 10) * 10} m · ${when}`,
        tone: t.level === 'hit' ? 'alert' : 'warn',
        dim: t.level === 'clear',
      });
    }
    const keys = new Set(chips.map((c) => c.key));
    for (const c of chips) {
      let e = this.chipEls.get(c.key);
      if (!e) {
        e = el('div', 'chip', this.chips);
        this.chipEls.set(c.key, e);
      }
      e.hidden = false;
      e.textContent = c.text;
      e.dataset.tone = c.tone;
      e.dataset.dim = c.dim ? '1' : '0';
    }
    for (const [k, e] of this.chipEls) if (!keys.has(k)) e.hidden = true;
  }

  private renderPanel({ own }: BattleHudInput): void {
    const d = own.damage;
    const s = d.summary();
    this.panelTitle.textContent = `${own.name.toUpperCase()} - ${s.status === 'afloat' ? 'DAMAGE REPORT' : s.status.toUpperCase()}`;
    const length = d.comps.reduce((m, c) => Math.max(m, c.spec.x1), 0) - d.comps.reduce((m, c) => Math.min(m, c.spec.x0), 0);
    for (const c of d.comps) {
      let cell = this.cells.get(c.spec.id);
      if (!cell) {
        const box = el('div', 'dcell', this.hull);
        const water = el('i', 'water', box);
        const fire = el('i', 'fireglow', box);
        el('span', '', box, c.spec.id.replace('mag-', 'M-').replace('boiler-', 'B').replace('steering', 'STR').replace('engine', 'ENG').replace('stern', 'STN').replace('bow', 'BOW'));
        box.style.flexGrow = String(((c.spec.x1 - c.spec.x0) / length) * 100);
        box.title = c.spec.name;
        cell = { box, water, fire };
        this.cells.set(c.spec.id, cell);
      }
      cell.water.style.height = `${Math.round((c.flood / c.spec.capacityT) * 100)}%`;
      cell.fire.style.opacity = String(Math.min(1, c.fire * 1.2));
      cell.box.dataset.state = c.integrity < 0.35 ? 'wrecked' : c.integrity < 0.7 ? 'damaged' : 'sound';
    }
    // The hull is drawn stern to bow, left to right: reorder by position.
    const ordered = [...d.comps].sort((a, b) => a.spec.x0 - b.spec.x0);
    ordered.forEach((c, i) => {
      const cell = this.cells.get(c.spec.id)!;
      if (this.hull.children[i] !== cell.box) this.hull.insertBefore(cell.box, this.hull.children[i] ?? null);
    });

    this.turrets.replaceChildren();
    for (const t of d.turrets) {
      const chip = el('div', 'dturret', this.turrets);
      chip.dataset.state = t.state === 'ok' && t.crew < 0.5 ? 'weak' : t.state;
      el('b', '', chip, t.id);
      el('span', '', chip, `${t.state === 'ok' && t.crew < 0.5 ? 'SHORT-HANDED' : (STATE_TEXT[t.state] ?? t.state)}${t.fire > 0.05 ? ' · FIRE' : ''}`);
    }

    const rows: [string, string][] = [
      ['Speed', `${(own.speed / KNOT).toFixed(1)} kn of ${own.maxSpeedKn} (engines ${Math.round(s.power * 100)}%)`],
      ['Steering', s.steeringFailed ? 'JAMMED' : 'sound'],
      ['Fire control', `${Math.round(s.fireControl * 100)}%`],
      ['Crew', `${Math.round(s.crew * 100)}% fit`],
      ['Water aboard', `${Math.round(s.floodedT)} t of ${Math.round(s.reserveT)} t reserve`],
      ['List / trim', `${s.listDeg >= 0 ? 'stbd ' : 'port '}${Math.abs(s.listDeg).toFixed(1)}° / ${s.trimDeg >= 0 ? 'stern ' : 'bow '}${Math.abs(s.trimDeg).toFixed(1)}°`],
      ['Fires', String(s.fires)],
    ];
    this.facts.replaceChildren();
    for (const [k, v] of rows) {
      const row = el('div', 'drow', this.facts);
      el('label', '', row, k);
      el('output', '', row, v);
    }
  }

  private renderResult({ outcome, prestige = null }: BattleHudInput): void {
    const show = outcome !== null && !this.dismissed;
    this.result.hidden = !show;
    if (!show || !outcome) return;
    this.result.dataset.result = outcome.result;
    this.resultTitle.textContent = outcome.result === 'victory' ? 'VICTORY' : 'DEFEAT';
    this.resultHow.textContent = outcome.how;
    const lines = [
      `Time ${clock(outcome.seconds)}`,
      `Shells fired ${outcome.shellsFired}`,
      `Hits on the enemy ${outcome.hitsScored}`,
      `Hits taken ${outcome.hitsTaken}`,
    ];
    if (outcome.shore) lines.push(`Batteries silenced ${outcome.shore.silenced} of ${outcome.shore.forts}; groundings ${outcome.shore.groundings}; mines struck ${outcome.shore.mines}`);
    if (outcome.torpedoes) lines.push(`Torpedoes fired at you ${outcome.torpedoes.fired}, hits ${outcome.torpedoes.hits}`);
    if (outcome.dishonour > 0) lines.push(`You fired ${outcome.dishonour} shells at a ship that had struck her colours.`);
    this.resultStats.replaceChildren(...lines.map((l) => el('div', outcome.dishonour > 0 && l.startsWith('You') ? 'dishonour' : '', undefined, l)));
    this.resultPrestige.hidden = prestige === null;
    if (prestige) {
      const rows = prestige.lines.map((l) => {
        const row = el('div', '', undefined);
        el('span', '', row, l.label);
        el('span', '', row, `${l.fraction >= 0 ? '+' : '-'}${Math.round(Math.abs(l.fraction) * prestige.base)}`);
        return row;
      });
      const head = el('b', '', undefined, `PRESTIGE +${prestige.earned}   (now ${prestige.total})`);
      this.resultPrestige.replaceChildren(head, ...rows);
    }
  }
}
