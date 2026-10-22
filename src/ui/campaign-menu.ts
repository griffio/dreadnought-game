import type { Campaign } from '../campaign/campaign';
import { MISSIONS, PLAYTESTS, PRACTICE, type MissionDef } from '../campaign/missions';
import { REFITS, nextRefitCost } from '../campaign/refits';
import { isShipId, shipById } from '../data/ships/roster';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.append(e);
  return e;
}

type Tab = 'sorties' | 'dock';

/**
 * The front door: the sorties to choose from with their orders, the prestige in hand, and the dockyard where it is spent.
 * It only chooses: starting a sortie is a callback, and everything it shows comes from the campaign.
 */
export class CampaignMenu {
  readonly element: HTMLDivElement;
  private readonly prestige: HTMLElement;
  private readonly list: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly dock: HTMLDivElement;
  private readonly tabs: Record<Tab, HTMLButtonElement>;
  private selected: string;
  private tab: Tab = 'sorties';

  constructor(
    root: HTMLElement,
    private readonly campaign: Campaign,
    private readonly onSail: (mission: MissionDef) => void,
    /** The sortie now shown, so that the ship at anchor can be hers. */
    private readonly onSelect: (mission: MissionDef) => void = () => {},
  ) {
    this.element = el('div', 'menu');
    const top = el('div', 'mtop', this.element);
    const brand = el('div', 'mbrand', top);
    el('div', 'mtitle', brand, 'FALL OF SHOT');
    this.caption = el('div', 'msub', brand, 'HMS DREADNOUGHT  ·  1907');
    const tabs = el('div', 'mtabs', top);
    this.tabs = {
      sorties: el('button', 'mtab', tabs, 'SORTIES'),
      dock: el('button', 'mtab', tabs, 'DRY DOCK'),
    };
    this.tabs.sorties.addEventListener('click', () => this.show('sorties'));
    this.tabs.dock.addEventListener('click', () => this.show('dock'));
    const pres = el('div', 'mprestige', top);
    el('label', '', pres, 'PRESTIGE');
    this.prestige = el('b', '', pres, '0');

    const body = el('div', 'mbody', this.element);
    this.list = el('div', 'mlist', body);
    this.detail = el('div', 'mdetail', body);
    this.dock = el('div', 'mdock', body);

    const foot = el('div', 'mfoot', this.element);
    const unlock = el('button', 'mlink', foot);
    unlock.addEventListener('click', () => {
      this.campaign.setUnlockAll(!this.campaign.state.unlockAll);
      this.refresh();
    });
    this.unlockBtn = unlock;
    const reset = el('button', 'mlink', foot, 'Start the campaign afresh');
    reset.addEventListener('click', () => {
      if (reset.dataset.armed === '1') {
        this.campaign.reset();
        reset.dataset.armed = '0';
        reset.textContent = 'Start the campaign afresh';
        this.selected = MISSIONS[0]!.id;
        this.refresh();
      } else {
        reset.dataset.armed = '1';
        reset.textContent = 'Tap again to wipe the campaign';
      }
    });
    root.append(this.element);

    // The furthest open sortie that has not been won, or the last, is the one to suggest.
    this.selected = this.suggested();
    this.refresh();
  }

  private readonly unlockBtn: HTMLButtonElement;
  private readonly caption: HTMLElement;

  private suggested(): string {
    // A player who has neither won a sortie nor been to the school is sent to the school first.
    const won = MISSIONS.some((m) => (this.campaign.state.missions[m.id]?.wins ?? 0) > 0);
    const school = PRACTICE.find((p) => !this.campaign.practiceDone(p.id));
    if (school && !won) return school.id;
    for (const m of MISSIONS) if (this.campaign.isUnlocked(m.id) && (this.campaign.state.missions[m.id]?.wins ?? 0) === 0) return m.id;
    return MISSIONS[MISSIONS.length - 1]!.id;
  }

  show(tab: Tab): void {
    this.tab = tab;
    this.refresh();
  }

  /** Redraw from the campaign. */
  refresh(): void {
    this.prestige.textContent = String(this.campaign.prestige);
    for (const [k, b] of Object.entries(this.tabs)) b.dataset.on = k === this.tab ? '1' : '0';
    this.list.hidden = this.tab !== 'sorties';
    this.detail.hidden = this.tab !== 'sorties';
    this.dock.hidden = this.tab !== 'dock';
    this.unlockBtn.textContent = this.campaign.state.unlockAll ? 'Lock the later sorties again' : 'Open every sortie (practice)';
    if (this.tab === 'sorties') {
      this.renderList();
      this.renderDetail();
    } else this.renderDock();
  }

  private renderList(): void {
    this.list.replaceChildren();
    const won = MISSIONS.some((m) => (this.campaign.state.missions[m.id]?.wins ?? 0) > 0);
    for (const p of PRACTICE) {
      const done = this.campaign.practiceDone(p.id);
      const card = el('button', 'mcard practice', this.list);
      card.dataset.id = p.id;
      card.dataset.selected = p.id === this.selected ? '1' : '0';
      card.dataset.locked = '0';
      el('span', 'mnum', card, 'T');
      const text = el('span', 'mtext', card);
      el('b', '', text, p.title);
      el('i', '', text, 'Learn to aim the guns');
      el('span', 'mstate', card, done ? 'DONE' : won ? 'OPTIONAL' : 'START HERE');
      card.addEventListener('click', () => {
        this.selected = p.id;
        this.refresh();
      });
    }
    for (const t of PLAYTESTS) {
      const card = el('button', 'mcard playtest', this.list);
      card.dataset.id = t.id;
      card.dataset.selected = t.id === this.selected ? '1' : '0';
      card.dataset.locked = '0';
      el('span', 'mnum', card, 'P');
      const text = el('span', 'mtext', card);
      el('b', '', text, t.title);
      el('i', '', text, 'A quicker game: try it');
      el('span', 'mstate', card, 'PLAYTEST');
      card.addEventListener('click', () => {
        this.selected = t.id;
        this.refresh();
      });
    }
    MISSIONS.forEach((m, i) => {
      const open = this.campaign.isUnlocked(m.id);
      const rec = this.campaign.state.missions[m.id];
      const card = el('button', 'mcard', this.list);
      card.dataset.id = m.id;
      card.dataset.selected = m.id === this.selected ? '1' : '0';
      card.dataset.locked = open ? '0' : '1';
      el('span', 'mnum', card, String(i + 1));
      const text = el('span', 'mtext', card);
      el('b', '', text, m.title);
      el('i', '', text, `${m.place}, ${m.year}`);
      el('span', 'mstate', card, !open ? 'LOCKED' : rec && rec.wins > 0 ? `WON x${rec.wins}` : rec ? 'TRY AGAIN' : 'NEW');
      card.addEventListener('click', () => {
        this.selected = m.id;
        this.refresh();
      });
    });
  }

  private renderDetail(): void {
    const m = [...PRACTICE, ...PLAYTESTS, ...MISSIONS].find((x) => x.id === this.selected) ?? MISSIONS[0]!;
    const open = m.practice === true || m.playtest === true || this.campaign.isUnlocked(m.id);
    const rec = this.campaign.state.missions[m.id];
    this.detail.replaceChildren();
    el('div', 'dhead', this.detail, `${m.title.toUpperCase()}`);
    el('div', 'dsub', this.detail, `${m.place}  ·  ${m.year}`);
    const ship = shipById(m.ship);
    this.caption.textContent = ship.caption.toUpperCase().replace(' · ', '  ·  ');
    this.onSelect(m);
    const card = el('div', 'dship', this.detail);
    el('label', '', card, 'YOUR SHIP');
    el('b', '', card, ship.caption);
    el('span', '', card, ship.character);
    const foeId = m.params?.foe;
    if (m.practice) {
      const against = el('div', 'dfoe', this.detail);
      el('label', '', against, 'AGAINST');
      el('span', '', against, `${shipById('hessen').caption}, a target that does not fire back`);
    } else if (isShipId(foeId) || m.scenario === 'destroyers') {
      const foe = shipById(isShipId(foeId) ? foeId : 'destroyer');
      const esc = Number(m.params?.esc ?? 0);
      const against = el('div', 'dfoe', this.detail);
      el('label', '', against, 'AGAINST');
      el('span', '', against, `${foe.caption}${esc > 0 ? `, with ${esc} torpedo boat${esc === 1 ? '' : 's'}` : m.scenario === 'destroyers' ? `, ${m.params?.dd ?? 2} boats` : ''}`);
    }
    const brief = el('div', 'dbrief', this.detail);
    for (const p of m.briefing) el('p', '', brief, p);
    const obj = el('div', 'dobj', this.detail);
    el('label', '', obj, 'YOUR ORDERS');
    el('span', '', obj, m.objective);
    const hints = el('ul', 'dhints', this.detail);
    for (const h of m.hints) el('li', '', hints, h);
    const foot = el('div', 'dfoot', this.detail);
    const info = el('div', 'dinfo', foot);
    el('span', '', info, m.practice ? 'Practice: it pays no prestige and cannot be lost.' : m.playtest ? 'Playtest: a real fight at a quicker pace. It pays no prestige and is not recorded.' : `Prestige for a win: ${m.basePrestige}, and more for good gunnery, a ship brought home in good order, and a quick finish.`);
    if (rec && rec.wins > 0) el('span', 'dbest', info, `Best: ${rec.best} prestige`);
    const sail = el('button', 'msail', foot, open ? (m.practice || m.playtest ? 'BEGIN' : 'SAIL') : 'LOCKED');
    sail.disabled = !open;
    if (!open) {
      const prev = MISSIONS[MISSIONS.findIndex((x) => x.id === m.id) - 1];
      el('span', 'dlock', info, prev ? `Win “${prev.title}” first.` : '');
    }
    sail.addEventListener('click', () => this.onSail(m));
  }

  private renderDock(): void {
    this.dock.replaceChildren();
    el('div', 'dhead', this.dock, 'DRY DOCK');
    el('div', 'dsub', this.dock, 'Prestige buys the Admiralty’s attention. Fit what you need before the next sortie; the work is permanent.');
    const grid = el('div', 'dgrid', this.dock);
    for (const r of REFITS) {
      const level = this.campaign.levels[r.id];
      const next = nextRefitCost(r.id, level);
      const row = el('div', 'drefit', grid);
      row.dataset.id = r.id;
      const head = el('div', 'drhead', row);
      el('b', '', head, r.name);
      const pips = el('span', 'dpips', head);
      for (let i = 0; i < r.levels.length; i++) el('i', i < level ? 'on' : '', pips);
      el('p', '', row, r.blurb);
      const now = level > 0 ? r.levels[level - 1]! : null;
      el('div', 'drnow', row, now ? `Fitted: ${now.label}. ${now.effect}` : 'As built.');
      if (next === null) {
        el('div', 'drfull', row, 'Fully fitted');
      } else {
        const up = r.levels[level]!;
        const buy = el('button', 'dbuy', row);
        el('span', '', buy, `${up.label}  ·  ${up.effect}`);
        el('b', '', buy, `${next}`);
        buy.disabled = next > this.campaign.prestige;
        buy.addEventListener('click', () => {
          if (this.campaign.buy(r.id)) this.refresh();
        });
      }
    }
  }
}
