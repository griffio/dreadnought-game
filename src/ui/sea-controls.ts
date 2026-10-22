import type { Camera } from '../render/camera';
import type { SeaParams } from '../render/sea-renderer';

interface Row {
  label: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
  /** Re-seed the waves when the value is committed (wind speed, heading). */
  regenerate?: boolean;
  format?: (v: number) => string;
}

/** Slider panel for the M1 showcase: sun, weather, wind, camera height. Touch-sized rows. */
export class SeaControls {
  readonly element: HTMLDetailsElement;
  cycleSun = false;
  private readonly refreshers: (() => void)[] = [];
  private readonly actionsRow: HTMLDivElement;

  constructor(
    root: HTMLElement,
    private readonly params: SeaParams,
    private readonly camera: Camera,
    private readonly onRegenerate: () => void,
  ) {
    this.element = document.createElement('details');
    this.element.className = 'panel controls';
    this.element.open = window.innerWidth > 700 && navigator.maxTouchPoints === 0;
    const summary = document.createElement('summary');
    summary.textContent = 'Sea & sky';
    this.element.append(summary);

    const p = params;
    const rows: Row[] = [
      { label: 'Sun elevation', min: -12, max: 60, step: 0.5, get: () => p.sunElevationDeg, set: (v) => (p.sunElevationDeg = v), format: (v) => `${v.toFixed(1)}°` },
      { label: 'Sun azimuth', min: 0, max: 360, step: 1, get: () => p.sunAzimuthDeg, set: (v) => (p.sunAzimuthDeg = v), format: (v) => `${v.toFixed(0)}°` },
      { label: 'Clouds', min: 0, max: 1, step: 0.01, get: () => p.cloudCover, set: (v) => (p.cloudCover = v) },
      { label: 'Wind', min: 3, max: 28, step: 0.5, get: () => p.windSpeed, set: (v) => (p.windSpeed = v), regenerate: true, format: (v) => `${v.toFixed(1)} m/s` },
      { label: 'Wave heading', min: 0, max: 360, step: 1, get: () => p.waveHeadingDeg, set: (v) => (p.waveHeadingDeg = v), regenerate: true, format: (v) => `${v.toFixed(0)}°` },
      { label: 'Choppiness', min: 0, max: 2, step: 0.05, get: () => p.choppiness, set: (v) => (p.choppiness = v) },
      { label: 'Visibility', min: 5, max: 80, step: 1, get: () => p.visibilityKm, set: (v) => (p.visibilityKm = v), format: (v) => `${v.toFixed(0)} km` },
      { label: 'Exposure', min: -2, max: 2, step: 0.1, get: () => p.exposureBias, set: (v) => (p.exposureBias = v), format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} EV` },
      { label: 'Bloom', min: 0, max: 0.4, step: 0.01, get: () => p.bloom, set: (v) => (p.bloom = v) },
      { label: 'Camera height', min: 2, max: 300, step: 1, get: () => camera.position[1], set: (v) => (camera.position[1] = v), format: (v) => `${v.toFixed(0)} m` },
    ];
    for (const row of rows) this.element.append(this.buildRow(row));

    this.actionsRow = document.createElement('div');
    this.actionsRow.className = 'actions';
    this.element.append(this.actionsRow);

    const cycle = document.createElement('label');
    cycle.className = 'row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => (this.cycleSun = box.checked));
    cycle.append(box, document.createTextNode(' Animate sun (dawn to dusk)'));
    this.element.append(cycle);

    root.append(this.element);
  }

  /** A slider appended to the panel (game settings that are not about the sea). */
  addSlider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, format?: (v: number) => string): void {
    this.element.insertBefore(this.buildRow({ label, min, max, step, get, set, format }), this.actionsRow);
  }

  /** A tappable button in the panel's action row (camera presets, fire salvo, ...). */
  addButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'button small';
    button.textContent = label;
    button.addEventListener('click', onClick);
    this.actionsRow.append(button);
    return button;
  }

  /** A labelled checkbox appended to the panel. */
  addToggle(label: string, onChange: (on: boolean) => void, initial = false): void {
    const wrap = document.createElement('label');
    wrap.className = 'row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = initial;
    box.addEventListener('change', () => onChange(box.checked));
    wrap.append(box, document.createTextNode(` ${label}`));
    this.element.append(wrap);
  }

  /** Re-read values that change outside the panel (sun animation, camera movement). */
  refresh(): void {
    for (const r of this.refreshers) r();
  }

  private buildRow(row: Row): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'row';
    const name = document.createElement('span');
    name.textContent = row.label;
    const value = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(row.min);
    input.max = String(row.max);
    input.step = String(row.step);
    const show = () => {
      const v = row.get();
      input.value = String(v);
      value.textContent = row.format ? row.format(v) : v.toFixed(2);
    };
    show();
    this.refreshers.push(() => {
      if (document.activeElement !== input) show();
    });
    input.addEventListener('input', () => {
      row.set(Number(input.value));
      value.textContent = row.format ? row.format(Number(input.value)) : Number(input.value).toFixed(2);
    });
    if (row.regenerate) input.addEventListener('change', () => this.onRegenerate());
    wrap.append(name, input, value);
    return wrap;
  }
}
