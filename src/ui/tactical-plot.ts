import type { PlotView } from '../app/game';

const SIZE = 180;
/** Metres from the centre to the edge of the plot. */
const RADIUS_M = 5200;
/** Range rings as fractions of the plot's radius. */
const RING_FRACTIONS = [0.2, 0.5, 0.96];

const COLOUR = {
  ring: 'rgb(201 162 75 / 0.28)',
  own: '#e9e2cf',
  enemy: '#e0594a',
  enemyDead: '#6f7782',
  designated: '#ffd27a',
  ours: '#8fd18f',
  clear: '#d8c870',
  close: '#f09a3e',
  hit: '#ff5a4a',
  smoke: 'rgb(226 232 238 / 0.22)',
  arc: 'rgb(201 162 75 / 0.35)',
  land: 'rgb(122 108 76 / 0.9)',
  landHigh: 'rgb(150 132 92 / 0.95)',
  shoal: 'rgb(150 76 60 / 0.5)',
};

/**
 * The chart table: a small plot of the surrounding water, bow up, with the ships that can be seen, the wakes that have been,
 * ours and theirs, and the smoke. A torpedo's track is drawn ahead of it as far as it will run in a minute.
 */
export class TacticalPlot {
  readonly element: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private scale: number;
  private radius = RADIUS_M;
  private sinceDraw = 1;
  private shown = true;

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'chartplot';
    this.canvas = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = SIZE * dpr;
    this.canvas.height = SIZE * dpr;
    this.canvas.style.width = `${SIZE}px`;
    this.canvas.style.height = `${SIZE}px`;
    this.g = this.canvas.getContext('2d');
    this.g?.scale(dpr, dpr);
    this.scale = SIZE / 2 / RADIUS_M;
    this.element.append(this.canvas);
    const label = document.createElement('span');
    label.textContent = 'PLOT';
    this.element.append(label);
    root.append(this.element);
  }

  /** Set what the edge of the plot is, in metres: a few kilometres for a torpedo attack, a dozen for a bombardment. */
  setRadius(metres: number): void {
    this.radius = metres;
    this.scale = SIZE / 2 / metres;
  }

  get visible(): boolean {
    return this.shown;
  }

  set visible(v: boolean) {
    this.shown = v;
    this.element.hidden = !v;
  }

  toggle(): void {
    this.visible = !this.shown;
  }

  update(view: PlotView, dt: number, torpedoMode: boolean): void {
    if (!this.shown || !this.g) return;
    this.sinceDraw += dt;
    if (this.sinceDraw < 1 / 12) return;
    this.sinceDraw = 0;
    this.draw(this.g, view, torpedoMode);
  }

  /** World offset from the ship to screen metres, bow up. */
  private toPlot(view: PlotView, x: number, z: number): [number, number] {
    const dx = x - view.own.x;
    const dz = z - view.own.z;
    const h = view.own.heading;
    // Ahead (along the heading) goes up the screen; starboard goes right.
    const ahead = dx * Math.sin(h) - dz * Math.cos(h);
    const stbd = dx * Math.cos(h) + dz * Math.sin(h);
    return [SIZE / 2 + stbd * this.scale, SIZE / 2 - ahead * this.scale];
  }

  /** The land under the plot, sampled every few pixels: tan for land, dull red for water too shallow for the ship. */
  private drawLand(g: CanvasRenderingContext2D, view: PlotView): void {
    const terrain = view.land!;
    const step = 3;
    const h = view.own.heading;
    const sh = Math.sin(h);
    const ch = Math.cos(h);
    const c = SIZE / 2;
    for (let py = 0; py < SIZE; py += step) {
      for (let px = 0; px < SIZE; px += step) {
        const stbd = (px + step / 2 - c) / this.scale;
        const ahead = (c - (py + step / 2)) / this.scale;
        // Back from the plot to the world: ahead along the heading, starboard across it.
        const wx = view.own.x + ahead * sh + stbd * ch;
        const wz = view.own.z - ahead * ch + stbd * sh;
        const height = terrain.heightAt(wx, wz);
        if (height > 0.25) {
          g.fillStyle = height > 90 ? COLOUR.landHigh : COLOUR.land;
          g.fillRect(px, py, step, step);
        } else if (height > -10) {
          g.fillStyle = COLOUR.shoal;
          g.fillRect(px, py, step, step);
        }
      }
    }
  }

  private draw(g: CanvasRenderingContext2D, view: PlotView, torpedoMode: boolean): void {
    g.clearRect(0, 0, SIZE, SIZE);
    const c = SIZE / 2;
    g.save();
    g.beginPath();
    g.arc(c, c, c - 1, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgb(11 22 32 / 0.72)';
    g.fillRect(0, 0, SIZE, SIZE);

    // Range rings and the cross of the ship's own axes.
    g.strokeStyle = COLOUR.ring;
    g.lineWidth = 1;
    for (const f of RING_FRACTIONS) {
      g.beginPath();
      g.arc(c, c, f * this.radius * this.scale, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(c, 0);
    g.lineTo(c, SIZE);
    g.moveTo(0, c);
    g.lineTo(SIZE, c);
    g.stroke();

    // The land: sampled over the plot, shoals and land in different tones.
    if (view.land) this.drawLand(g, view);

    // The tubes' firing arcs, while the tubes are in hand.
    if (torpedoMode) {
      g.strokeStyle = COLOUR.arc;
      g.fillStyle = 'rgb(201 162 75 / 0.12)';
      for (const [lo, hi] of view.tubeArcs) {
        g.beginPath();
        g.moveTo(c, c);
        // Bearing from the bow, clockwise; the canvas angle runs from +x, so rotate by a quarter turn.
        g.arc(c, c, 2400 * this.scale, lo - Math.PI / 2, hi - Math.PI / 2);
        g.closePath();
        g.fill();
        g.stroke();
      }
    }

    // The planned run of the fan, from the ship to where it is expected to meet its target.
    if (view.aim) {
      const [ax, ay] = this.toPlot(view, view.aim.x, view.aim.z);
      g.strokeStyle = COLOUR.ours;
      g.lineWidth = 1.2;
      g.setLineDash([4, 4]);
      g.beginPath();
      g.moveTo(c, c);
      g.lineTo(ax, ay);
      g.stroke();
      g.setLineDash([]);
      g.strokeRect(ax - 3, ay - 3, 6, 6);
    }

    // Smoke.
    g.fillStyle = COLOUR.smoke;
    for (const s of view.smoke) {
      const [x, y] = this.toPlot(view, s.x, s.z);
      if (Math.hypot(x - c, y - c) > c + s.r * this.scale) continue;
      g.beginPath();
      g.arc(x, y, Math.max(s.r * this.scale, 1.5), 0, Math.PI * 2);
      g.fill();
    }

    // Torpedo tracks: a line ahead of each, as far as it goes in a minute.
    for (const t of view.torpedoes) {
      const [x, y] = this.toPlot(view, t.x, t.z);
      const rel = t.heading - view.own.heading;
      const ahead = Math.cos(rel);
      const side = Math.sin(rel);
      const reach = Math.max(17 * 60 * this.scale, 8);
      g.strokeStyle = COLOUR[t.level === 'ours' ? 'ours' : t.level];
      g.fillStyle = g.strokeStyle;
      g.lineWidth = t.level === 'hit' ? 2.2 : 1.4;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + side * reach, y - ahead * reach);
      g.stroke();
      g.beginPath();
      g.arc(x, y, t.level === 'hit' ? 3.2 : 2.4, 0, Math.PI * 2);
      g.fill();
    }

    // Batteries the player knows of, mines that have been sighted, the aircraft.
    for (const f of view.forts) {
      const [x, y] = this.toPlot(view, f.x, f.z);
      g.strokeStyle = f.silenced ? COLOUR.enemyDead : f.designated ? COLOUR.designated : COLOUR.enemy;
      g.lineWidth = 1.6;
      g.strokeRect(x - 3.5, y - 3.5, 7, 7);
      if (!f.silenced) {
        g.fillStyle = g.strokeStyle;
        g.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }
    g.strokeStyle = COLOUR.hit;
    g.lineWidth = 1.3;
    for (const m of view.mines) {
      const [x, y] = this.toPlot(view, m.x, m.z);
      g.beginPath();
      g.moveTo(x - 2.4, y - 2.4);
      g.lineTo(x + 2.4, y + 2.4);
      g.moveTo(x + 2.4, y - 2.4);
      g.lineTo(x - 2.4, y + 2.4);
      g.stroke();
    }
    if (view.plane) {
      const [x, y] = this.toPlot(view, view.plane.x, view.plane.z);
      g.save();
      g.translate(x, y);
      g.rotate(view.plane.heading - view.own.heading);
      g.fillStyle = '#e9e2cf';
      g.beginPath();
      g.moveTo(0, -5);
      g.lineTo(4.5, 3);
      g.lineTo(0, 1);
      g.lineTo(-4.5, 3);
      g.closePath();
      g.fill();
      g.restore();
    }

    // Ships.
    for (const s of view.ships) {
      const [x, y] = this.toPlot(view, s.x, s.z);
      const rel = s.heading - view.own.heading;
      const len = Math.max(s.length * this.scale, s.small ? 6 : 9);
      g.save();
      g.translate(x, y);
      g.rotate(rel);
      g.fillStyle = s.designated ? COLOUR.designated : s.alive ? COLOUR.enemy : COLOUR.enemyDead;
      g.beginPath();
      g.moveTo(0, -len / 2);
      g.lineTo(len * 0.22, len / 2);
      g.lineTo(-len * 0.22, len / 2);
      g.closePath();
      g.fill();
      g.restore();
    }

    // Our own ship at the centre.
    g.fillStyle = COLOUR.own;
    const own = Math.max(view.own.length * this.scale, 11);
    g.beginPath();
    g.moveTo(c, c - own / 2);
    g.lineTo(c + own * 0.2, c + own / 2);
    g.lineTo(c - own * 0.2, c + own / 2);
    g.closePath();
    g.fill();
    g.restore();

    g.strokeStyle = 'rgb(201 162 75 / 0.9)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(c, c, c - 1, 0, Math.PI * 2);
    g.stroke();
  }
}
