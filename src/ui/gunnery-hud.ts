import type { InputDevice } from '../input/intent';
import type { Camera } from '../render/camera';
import type { Envelope } from '../sim/damage/envelope';
import type { Contact, GunneryStatus, TrackQuality } from '../sim/gunnery/gunnery';

const QUALITY_LABEL: Record<TrackQuality, string> = {
  none: 'NO TARGET',
  lost: 'TRACK LOST',
  plotting: 'PLOTTING',
  settling: 'SETTLING',
  settled: 'SETTLED',
  turned: 'TURNED - REPLOTTING',
};

const HINTS: Record<InputDevice, string> = {
  'keyboard-mouse': 'click ship: designate  ·  Space fire  ·  hold right-button / V: director sight  ·  Q/E range  ·  [ ] deflection  ·  T auto-spot  ·  Tab next target  ·  B cease fire  ·  F torpedo tubes  ·  M plot',
  gamepad: 'RB/LB target  ·  hold LT sight (R3/L3 zoom)  ·  RT fire  ·  D-pad corrections  ·  A auto-spot  ·  B cease fire  ·  X torpedo tubes  ·  SELECT plot',
  touch: '',
};

const SPOT_VISIBLE_SECONDS = 16;

const thousands = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const bearing3 = (deg: number): string => Math.round((deg + 360) % 360).toString().padStart(3, '0');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.append(e);
  return e;
}

/** What the gunnery officer can see of the enemy's condition. */
export interface EnemyReadout {
  /** A ship, or a battery on the shore. */
  kind?: 'ship' | 'fort';
  status: string;
  speedKn: number;
  turretsLost: number;
  turretsTotal: number;
  fires: number;
  listDeg: number;
  crew: number;
  flooding: boolean;
  /** A battery's crews, kept down by the shells falling about them, 0..1. */
  suppression?: number;
}

export interface GunneryHudInput {
  enemy: EnemyReadout | null;
  envelope: Envelope | null;
  status: GunneryStatus;
  camera: Camera;
  contacts: readonly Contact[];
  sightUp: boolean;
  sightFovDeg: number;
  hits: number;
  width: number;
  height: number;
}

/**
 * The gunnery officer's report: the target card with range, bearing, plotted course and speed, flight time and how well
 * the plot has settled; the turrets' readiness; the spotter's calls and the corrections in force. Brackets mark ships on
 * the screen (click one to designate it) and a ring shows where the shells are expected to land.
 */
export class GunneryHud {
  readonly element: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly name: HTMLDivElement;
  private readonly quality: HTMLDivElement;
  private readonly range: HTMLOutputElement;
  private readonly bearing: HTMLOutputElement;
  private readonly tof: HTMLOutputElement;
  private readonly rate: HTMLOutputElement;
  private readonly corr: HTMLDivElement;
  private readonly salvo: HTMLDivElement;
  private readonly enemyLine: HTMLDivElement;
  private readonly ruler: HTMLDivElement;
  private readonly rulerMark: HTMLElement;
  private rulerFor: Envelope | null = null;
  private readonly pips: HTMLDivElement;
  private readonly spot: HTMLDivElement;
  private readonly hints: HTMLDivElement;
  private readonly reticle: HTMLDivElement;
  private readonly reticleText: HTMLDivElement;
  private readonly pip: HTMLDivElement;
  private readonly brackets = new Map<number, { box: HTMLDivElement; label: HTMLDivElement }>();
  private readonly pipEls = new Map<string, HTMLDivElement>();
  private readonly tmp: [number, number] = [0, 0];

  constructor(private readonly root: HTMLElement) {
    this.element = el('div', 'gunnery');
    this.card = el('div', 'gcard', this.element);
    const head = el('div', 'ghead', this.card);
    this.name = el('div', 'gname', head);
    this.quality = el('div', 'gquality', head);
    const grid = el('div', 'ggrid', this.card);
    const cell = (label: string) => {
      const c = el('div', 'gcell', grid);
      el('label', '', c, label);
      return el('output', '', c);
    };
    this.range = cell('RANGE');
    this.bearing = cell('BEARING');
    this.tof = cell('FLIGHT');
    this.rate = cell('PLOT');
    this.corr = el('div', 'gcorr', this.card);
    this.pips = el('div', 'gpips', this.card);
    this.salvo = el('div', 'gsalvo', this.card);
    this.enemyLine = el('div', 'genemy', this.card);
    this.ruler = el('div', 'gruler', this.card);
    this.rulerMark = el('i', 'mark', this.ruler);
    this.spot = el('div', 'gspot', this.element);
    this.reticle = el('div', 'greticle', this.element);
    el('i', 'h', this.reticle);
    el('i', 'v', this.reticle);
    el('b', 'ring', this.reticle);
    this.reticleText = el('div', 'rtext', this.reticle);
    this.pip = el('div', 'gpip', this.element);
    el('span', '', this.pip, 'AIM');
    this.hints = el('div', 'ghints', this.element);
    root.append(this.element);
    this.setDevice('keyboard-mouse');
  }

  setDevice(device: InputDevice): void {
    this.hints.textContent = HINTS[device];
    this.hints.hidden = HINTS[device] === '';
  }

  update(input: GunneryHudInput): void {
    const { status: s, camera } = input;
    const t = s.target;

    this.card.classList.toggle('idle', t === null);
    this.name.textContent = t ? t.name.toUpperCase() : 'NO TARGET - CLICK A SHIP';
    this.quality.textContent = QUALITY_LABEL[s.quality];
    this.quality.dataset.q = s.quality;
    this.range.textContent = t ? `${thousands(t.range)} m` : '-';
    this.bearing.textContent = t
      ? `${bearing3(t.bearingDeg)}${t.spotted ? '  SPOTTER' : !t.visible ? '  BEHIND LAND' : t.hullDown ? '  HULL DOWN' : ''}`
      : '-';
    const sol = s.solution;
    this.tof.textContent = t && sol ? `${sol.tof.toFixed(1)} s` : '-';
    this.rate.textContent =
      t && s.estimate && s.quality !== 'plotting' ? `${s.estimate.speedKn.toFixed(1)} kn  ${bearing3(s.estimate.courseDeg)}` : t ? 'PLOTTING' : '-';

    const c = s.corrections;
    const range = `${c.range >= 0 ? '+' : '-'}${Math.round(Math.abs(c.range))}`;
    const defl = Math.abs(c.deflection) < 0.5 ? '0' : `${c.deflection > 0 ? 'R' : 'L'}${Math.round(Math.abs(c.deflection))}`;
    this.corr.textContent = `CORRECTION  RANGE ${range}  DEFL ${defl}   AUTO-SPOT ${s.autoSpot ? 'ON' : 'OFF'}`;
    this.corr.classList.toggle('auto', s.autoSpot);

    this.renderPips(s);

    const bearingTurrets = s.turrets.filter((x) => x.bears);
    const ready = bearingTurrets.filter((x) => x.loaded >= 1 && x.aligned).length;
    const firing = s.turrets.some((x) => x.firing);
    let line: string;
    let tone: string;
    if (firing) {
      line = 'FIRING';
      tone = 'go';
    } else if (s.armed) {
      line = 'SALVO ARMED - WAITING FOR THE GUNS';
      tone = 'armed';
    } else if (bearingTurrets.length === 0) {
      line = t ? 'GUNS DO NOT BEAR' : 'GUNS HOLDING';
      tone = 'blind';
    } else if (t && sol && !sol.valid) {
      line = 'OUT OF RANGE';
      tone = 'blind';
    } else {
      line = `${ready} OF ${bearingTurrets.length} TURRETS READY`;
      tone = ready === bearingTurrets.length ? 'go' : 'wait';
    }
    if (s.shellsInFlight > 0 && s.nextSplashIn !== null) line += `   SPLASH IN ${Math.ceil(s.nextSplashIn)} s`;
    if (input.hits > 0) line += `   HITS ${input.hits}`;
    this.salvo.textContent = line;
    this.salvo.dataset.tone = tone;

    // The spotter's call.
    const r = s.lastReport;
    const showSpot = r !== null && s.reportAge < SPOT_VISIBLE_SECONDS;
    this.spot.hidden = !showSpot;
    if (showSpot) {
      this.spot.textContent = r.text;
      this.spot.dataset.call = r.call;
      this.spot.style.opacity = String(Math.min(1, (SPOT_VISIBLE_SECONDS - s.reportAge) / 4));
    }

    this.renderEnemy(input);
    this.renderBrackets(input);

    // The director's sight.
    this.reticle.hidden = !input.sightUp;
    if (input.sightUp) this.reticleText.textContent = `FIELD ${input.sightFovDeg.toFixed(1)}°`;
  }

  private renderEnemy({ enemy, envelope, status }: GunneryHudInput): void {
    const t = status.target;
    this.enemyLine.hidden = !enemy || !t;
    if (enemy && t) {
      if (enemy.kind === 'fort') {
        const bits = [
          enemy.status === 'silenced' ? 'SILENCED' : 'FIRING',
          `GUNS ${enemy.turretsTotal - enemy.turretsLost}/${enemy.turretsTotal}`,
          `CREWS ${Math.round(enemy.crew * 100)}%`,
        ];
        if ((enemy.suppression ?? 0) > 0.15) bits.push(`KEPT DOWN ${Math.round((enemy.suppression ?? 0) * 100)}%`);
        this.enemyLine.textContent = `BATTERY  ${bits.join('  ·  ')}`;
        this.ruler.hidden = true;
        return;
      }
      const bits = [
        enemy.status === 'afloat' ? 'UNDER WAY' : enemy.status.toUpperCase(),
        `${enemy.speedKn.toFixed(0)} kn`,
        `GUNS ${enemy.turretsTotal - enemy.turretsLost}/${enemy.turretsTotal}`,
      ];
      if (enemy.fires > 0) bits.push(`FIRES ${enemy.fires}`);
      if (Math.abs(enemy.listDeg) > 1.5) bits.push(`LIST ${Math.abs(enemy.listDeg).toFixed(0)}° ${enemy.listDeg > 0 ? 'STBD' : 'PORT'}`);
      if (enemy.flooding) bits.push('FLOODING');
      this.enemyLine.textContent = `ENEMY  ${bits.join('  ·  ')}`;
    }
    // The penetration ruler: where our shells defeat her belt, her side, her deck.
    this.ruler.hidden = !envelope || !t;
    if (!envelope || !t) return;
    if (envelope !== this.rulerFor) {
      this.rulerFor = envelope;
      this.ruler.replaceChildren(this.rulerMark);
      for (const [layer, label] of [
        ['belt', 'BELT'],
        ['upper', 'SIDE'],
        ['deck', 'DECK'],
      ] as const) {
        const row = el('div', 'rrow', this.ruler);
        el('label', '', row, label);
        const bar = el('div', 'rbar', row);
        for (const b of envelope.bands) {
          const cell = el('i', b[layer] ? 'on' : '', bar);
          cell.style.flex = '1';
        }
      }
      const axis = el('div', 'raxis', this.ruler);
      const first = envelope.bands[0]!.range;
      const last = envelope.bands[envelope.bands.length - 1]!.range;
      el('span', '', axis, `${(first / 1000).toFixed(0)} km`);
      el('span', '', axis, 'SHELLS GET THROUGH WHERE LIT');
      el('span', '', axis, `${(last / 1000).toFixed(0)} km`);
    }
    const first = envelope.bands[0]!.range;
    const last = envelope.bands[envelope.bands.length - 1]!.range;
    const f = Math.min(Math.max((t.range - first) / (last - first), 0), 1);
    // The bars start after the 34 px label column.
    this.rulerMark.style.left = `calc(34px + (100% - 34px) * ${f})`;
  }

  private renderPips(s: GunneryStatus): void {
    for (const t of s.turrets) {
      let pip = this.pipEls.get(t.id);
      if (!pip) {
        pip = el('div', 'gpipbox', this.pips);
        el('i', 'fill', pip);
        el('span', '', pip, t.id);
        this.pipEls.set(t.id, pip);
      }
      const state = !t.bears ? 'blind' : t.loaded < 1 ? 'reload' : t.aligned ? 'ready' : 'slew';
      pip.dataset.state = t.firing ? 'firing' : state;
      pip.style.setProperty('--p', String(Math.round(t.loaded * 100)));
    }
  }

  private renderBrackets(input: GunneryHudInput): void {
    const { camera, contacts, status: s, width, height } = input;
    const wanted = new Set<number>();
    for (const c of contacts) {
      wanted.add(c.id);
      let b = this.brackets.get(c.id);
      if (!b) {
        const box = el('div', 'gbracket', this.element);
        for (const corner of ['tl', 'tr', 'bl', 'br']) el('i', corner, box);
        b = { box, label: el('div', 'blabel', box) };
        this.brackets.set(c.id, b);
      }
      const onScreen = camera.project(c.x, 9, c.z, this.tmp);
      if (!onScreen || Math.abs(this.tmp[0]) > 1.1 || Math.abs(this.tmp[1]) > 1.1) {
        b.box.hidden = true;
        continue;
      }
      const dist = Math.hypot(c.x - camera.position[0], c.z - camera.position[2]);
      const lengthPx = ((c.halfLength * 2) / Math.max(dist, 1) / (2 * camera.tanHalfFovY)) * height;
      const w = Math.min(Math.max(lengthPx * 1.25, 30), width * 0.6);
      const h = Math.max(w * 0.34, 22);
      b.box.hidden = false;
      b.box.style.width = `${w}px`;
      b.box.style.height = `${h}px`;
      b.box.style.transform = `translate(${((this.tmp[0] + 1) / 2) * width - w / 2}px, ${((1 - this.tmp[1]) / 2) * height - h / 2}px)`;
      const designated = s.target !== null && s.target.id === c.id;
      b.box.dataset.designated = designated ? '1' : '0';
      b.label.textContent = designated ? '' : `${(dist / 1000).toFixed(1)} km`;
    }
    for (const [id, b] of this.brackets) if (!wanted.has(id)) b.box.hidden = true;

    // Where the shells are expected to land, if the solution holds.
    const sol = s.solution;
    let pipShown = false;
    if (s.target && sol && sol.valid && camera.project(sol.aimX, 0, sol.aimZ, this.tmp)) {
      if (Math.abs(this.tmp[0]) < 1.05 && Math.abs(this.tmp[1]) < 1.05) {
        const px = ((this.tmp[0] + 1) / 2) * width;
        const py = ((1 - this.tmp[1]) / 2) * height;
        // Where the target itself is on screen: the pip is only worth drawing when it differs (lead, corrections).
        const tc = input.contacts.find((c) => c.id === s.target!.id);
        const onTarget = tc && camera.project(tc.x, 0, tc.z, this.tmp) && Math.hypot(((this.tmp[0] + 1) / 2) * width - px, ((1 - this.tmp[1]) / 2) * height - py) < 14;
        if (!onTarget) {
          this.pip.style.transform = `translate(${px}px, ${py}px)`;
          pipShown = true;
        }
      }
    }
    this.pip.hidden = !pipShown;
  }
}
