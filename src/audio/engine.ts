import type { AudioOut, Bus, LoopHandle, PlayOptions } from './director';

interface Entry {
  file: string;
  duration: number;
  bus: Bus;
  loop: boolean;
}

export interface Manifest {
  sounds: Record<string, Entry>;
}

export interface AudioSettings {
  muted: boolean;
  /** 0..1 */
  volume: number;
}

const STORAGE_KEY = 'fall-of-shot.audio';
const DEFAULTS: AudioSettings = { muted: false, volume: 0.8 };
/** No more one-shots than this sound at once: a long engagement would otherwise swamp the mixer on an iPad. */
const MAX_VOICES = 40;

/** The bus levels: the ambience sits under the guns, and a voice over both. */
const BUS_GAIN: Record<Bus, number> = { sfx: 1, ambience: 0.55, voice: 1 };

export function loadSettings(storage: Pick<Storage, 'getItem'> | null): AudioSettings {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const v = JSON.parse(raw) as Partial<AudioSettings>;
    return { muted: v.muted === true, volume: typeof v.volume === 'number' ? Math.min(Math.max(v.volume, 0), 1) : DEFAULTS.volume };
  } catch {
    return { ...DEFAULTS };
  }
}

/** What the engine has done, for the tests and the debug overlay. */
export interface AudioStats {
  state: AudioContextState | 'none';
  loaded: number;
  total: number;
  played: number;
  active: number;
  loops: number;
  byId: Record<string, number>;
  last: string | null;
}

/**
 * WebAudio under the director: decodes the game's sounds once, plays one-shots and loops through three buses (effects, ambience,
 * voice) into one master that the player's volume and mute control, and ducks the ambience under a heavy gun.
 *
 * Browsers (iPad Safari above all) will not start audio until the player touches the page, so nothing is created until `unlock` is
 * called from a gesture; sounds asked for before that are dropped, not queued, since a sound that arrives late is wrong.
 */
export class AudioEngine implements AudioOut {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses = new Map<Bus, GainNode>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly raw = new Map<string, ArrayBuffer>();
  private manifest: Manifest | null = null;
  private settings: AudioSettings;
  private voices = 0;
  private played = 0;
  private lastId: string | null = null;
  private readonly byId: Record<string, number> = {};
  private loopCount = 0;
  private decoding: Promise<void> | null = null;
  /** The game has stopped the clock (paused, or the page is hidden): a stray tap must not start it again. */
  private held = false;

  constructor(
    private readonly baseUrl = `${import.meta.env.BASE_URL}audio/`,
    private readonly storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage,
  ) {
    this.settings = loadSettings(this.storage);
  }

  /** Fetch the manifest and the encoded files (no audio context needed yet); resolves with the ids of the sounds there are. */
  async fetch(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}manifest.json`);
    if (!res.ok) throw new Error(`audio manifest: ${res.status}`);
    this.manifest = (await res.json()) as Manifest;
    const ids = Object.keys(this.manifest.sounds);
    await Promise.all(
      ids.map(async (id) => {
        try {
          const r = await fetch(`${this.baseUrl}${this.manifest!.sounds[id]!.file}`);
          if (r.ok) this.raw.set(id, await r.arrayBuffer());
        } catch {
          /* a sound that does not arrive is a sound that is not played */
        }
      }),
    );
    if (this.ctx) await this.decodeAll();
    return ids;
  }

  get ids(): string[] {
    return this.manifest ? Object.keys(this.manifest.sounds) : [];
  }

  /** Start the audio context. Call from a pointer, touch or key event. Safe to call again. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        // On iPad the ringer switch silences ordinary web audio; this asks for it to be treated as media, like a game's.
        const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
        if (session) session.type = 'playback';
      } catch {
        /* not supported */
      }
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = this.settings.muted ? 0 : this.settings.volume;
      master.connect(ctx.destination);
      this.master = master;
      for (const bus of ['sfx', 'ambience', 'voice'] as Bus[]) {
        const g = ctx.createGain();
        g.gain.value = BUS_GAIN[bus];
        g.connect(master);
        this.buses.set(bus, g);
      }
      void this.decodeAll();
    }
    if (!this.held && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
  }

  private decodeAll(): Promise<void> {
    if (this.decoding) return this.decoding;
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve();
    this.decoding = (async () => {
      for (const [id, data] of [...this.raw]) {
        if (this.buffers.has(id)) continue;
        try {
          // `decodeAudioData` takes the buffer away, so give it a copy and keep the original for a later context.
          this.buffers.set(id, await ctx.decodeAudioData(data.slice(0)));
        } catch {
          /* undecodable: skipped */
        }
      }
      this.decoding = null;
      // Sounds fetched while decoding still need doing.
      if (this.raw.size > this.buffers.size && this.ctx) void this.decodeAll();
    })();
    return this.decoding;
  }

  ready(id: string): boolean {
    return this.ctx !== null && this.buffers.has(id);
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  get muted(): boolean {
    return this.settings.muted;
  }

  get volume(): number {
    return this.settings.volume;
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    this.apply();
  }

  setVolume(volume: number): void {
    this.settings.volume = Math.min(Math.max(volume, 0), 1);
    this.apply();
  }

  private apply(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.volume, this.ctx.currentTime, 0.03);
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      /* private window: the setting lasts the session */
    }
  }

  /** The page is hidden, or the game paused: stop the clock so nothing sounds late. */
  suspend(): void {
    this.held = true;
    if (this.ctx?.state === 'running') void this.ctx.suspend().catch(() => {});
  }

  resume(): void {
    this.held = false;
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
  }

  stats(): AudioStats {
    return { state: this.ctx?.state ?? 'none', loaded: this.buffers.size, total: this.raw.size, played: this.played, active: this.voices, loops: this.loopCount, byId: { ...this.byId }, last: this.lastId };
  }

  private route(o: PlayOptions, entry: Entry | undefined): { head: AudioNode; tail: AudioNode; gain: GainNode } | null {
    const ctx = this.ctx;
    const bus = this.buses.get(o.bus ?? entry?.bus ?? 'sfx');
    if (!ctx || !bus) return null;
    const gain = ctx.createGain();
    gain.gain.value = o.gain ?? 1;
    const head: AudioNode = gain;
    let tail: AudioNode = gain;
    if (o.lowpass !== undefined && o.lowpass < 19000) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = o.lowpass;
      lp.Q.value = 0.5;
      gain.connect(lp);
      tail = lp;
    }
    if (o.pan !== undefined && Math.abs(o.pan) > 0.01 && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      tail.connect(p);
      tail = p;
    }
    tail.connect(bus);
    return { head, tail, gain };
  }

  play(id: string, o: PlayOptions = {}): void {
    const ctx = this.ctx;
    const buffer = this.buffers.get(id);
    if (!ctx || !buffer || ctx.state !== 'running' || this.settings.muted) return;
    if (this.voices >= MAX_VOICES) return;
    const r = this.route(o, this.manifest?.sounds[id]);
    if (!r) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = o.rate ?? 1;
    src.connect(r.head);
    this.voices++;
    this.played++;
    this.lastId = id;
    this.byId[id] = (this.byId[id] ?? 0) + 1;
    src.onended = () => {
      this.voices--;
      src.disconnect();
      r.tail.disconnect();
      r.gain.disconnect();
    };
    src.start(ctx.currentTime + Math.max(o.delay ?? 0, 0));
  }

  loop(id: string, o: PlayOptions = {}): LoopHandle {
    const ctx = this.ctx;
    const buffer = this.buffers.get(id);
    const none: LoopHandle = { set() {}, stop() {} };
    if (!ctx || !buffer) return none;
    const bus = this.buses.get(o.bus ?? 'ambience');
    if (!bus) return none;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(bus);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = o.rate ?? 1;
    src.connect(gain);
    // Start somewhere in the loop, so that two ships' engines are not in step.
    src.start(0, Math.random() * buffer.duration);
    gain.gain.setTargetAtTime(o.gain ?? 1, ctx.currentTime, 0.4);
    this.loopCount++;
    this.byId[id] = (this.byId[id] ?? 0) + 1;
    let stopped = false;
    return {
      set: (v) => {
        if (stopped) return;
        const t = ctx.currentTime;
        if (v.gain !== undefined) gain.gain.setTargetAtTime(Math.max(v.gain, 0), t, 0.25);
        if (v.rate !== undefined) src.playbackRate.setTargetAtTime(Math.max(v.rate, 0.1), t, 0.25);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        this.loopCount--;
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        src.stop(ctx.currentTime + 0.6);
        src.onended = () => {
          src.disconnect();
          gain.disconnect();
        };
      },
    };
  }

  duck(amount: number, seconds: number): void {
    const ctx = this.ctx;
    const amb = this.buses.get('ambience');
    if (!ctx || !amb) return;
    const t = ctx.currentTime;
    const base = BUS_GAIN.ambience;
    amb.gain.cancelScheduledValues(t);
    amb.gain.setTargetAtTime(base * (1 - Math.min(Math.max(amount, 0), 0.9)), t, 0.03);
    amb.gain.setTargetAtTime(base, t + 0.12, Math.max(seconds, 0.2) / 3);
  }
}
