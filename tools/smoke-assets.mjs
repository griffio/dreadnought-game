// A small run of the asset pipeline: a few weathering swatches and decals from FLUX.2 klein (Cloudflare Workers AI) and a few lines of
// crew speech from ElevenLabs, written to assets-src/smoke/ with a log of what made each. Run: node tools/smoke-assets.mjs [images|voices]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateImage, KLEIN_4B } from './lib/cloudflare.mjs';
import { listVoices, speak } from './lib/elevenlabs.mjs';
import { loadEnv } from './lib/env.mjs';

const OUT = fileURLToPath(new URL('../assets-src/smoke/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const env = loadEnv();
const which = process.argv[2] ?? 'all';
const log = [];

const STYLE = 'flat orthographic view, even diffuse lighting, no perspective, no cast shadows, no text, no people';
const SWATCHES = [
  { id: 'steel-plating', tile: true, prompt: `seamless tileable texture of weathered grey battleship hull steel plating with riveted plate seams and faint rust streaks, ${STYLE}` },
  { id: 'rust-streaks', tile: true, prompt: `seamless tileable grayscale mask of vertical rust streaks and salt stains running down a steel wall, black and white, ${STYLE}` },
  { id: 'deck-planks', tile: true, prompt: `seamless tileable texture of weathered teak ship deck planks with dark caulked seams, ${STYLE}` },
  { id: 'paint-wear', tile: true, prompt: `seamless tileable texture of worn naval grey paint chipped on steel showing red-brown primer and bare metal, ${STYLE}` },
  { id: 'grime-oil', tile: true, prompt: `seamless tileable grayscale mask of oil stains and dirty grime smears, black and white, ${STYLE}` },
  { id: 'scorch-decal', tile: false, prompt: `a single soot and scorch mark from an explosion, black burnt blast pattern with radiating streaks, grayscale mask, white background fading to black, centred on a plain black background, ${STYLE}` },
  { id: 'shell-hole-decal', tile: false, prompt: `a single jagged torn hole punched through grey steel plating by a shell, bent metal edges and scorching around it, centred on a plain black background, ${STYLE}` },
  { id: 'rivet-panels', tile: true, prompt: `seamless tileable texture of riveted armoured steel panels with bolted seams, painted dark grey, ${STYLE}` },
];

async function images() {
  console.log(`Images: ${SWATCHES.length} from ${KLEIN_4B}`);
  for (const [i, s] of SWATCHES.entries()) {
    const seed = 1000 + i;
    try {
      const { buffer, ext, ms } = await generateImage(env, { prompt: s.prompt, width: 1024, height: 1024, seed });
      const file = `${s.id}.${ext}`;
      writeFileSync(OUT + file, buffer);
      // A tiled 2x2 preview, to judge whether it repeats without a visible seam.
      if (s.tile) {
        try {
          execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', OUT + file, '-i', OUT + file, '-i', OUT + file, '-i', OUT + file, '-filter_complex', '[0][1][2][3]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0,scale=1024:1024', '-frames:v', '1', OUT + `${s.id}-tiled.png`]);
        } catch (e) {
          console.log('  (no tiled preview:', String(e.message).split('\n')[0], ')');
        }
      }
      console.log(`  ${file}  ${(buffer.length / 1024).toFixed(0)} KB  ${ms} ms`);
      log.push({ kind: 'image', file, model: KLEIN_4B, prompt: s.prompt, width: 1024, height: 1024, seed, bytes: buffer.length });
    } catch (e) {
      console.log(`  ${s.id}: FAILED ${e.message}`);
      log.push({ kind: 'image', id: s.id, error: e.message });
    }
  }
}

const LINES = [
  { id: 'lookout-torpedo', voice: 'George', text: 'Torpedo wake! Bearing zero four zero, closing!' },
  { id: 'gunnery-straddle', voice: 'Daniel', text: 'Straddle! Hold your range.' },
  { id: 'bridge-struck', voice: 'George', text: 'She has struck her colours, sir. Cease fire!' },
];

async function voices() {
  console.log(`Voices: ${LINES.length} lines from ElevenLabs`);
  const all = await listVoices(env);
  let chars = 0;
  for (const l of LINES) {
    const v = all.find((x) => x.name.startsWith(l.voice));
    if (!v) {
      console.log(`  ${l.id}: no voice called ${l.voice}`);
      continue;
    }
    try {
      const { buffer, characters } = await speak(env, { voiceId: v.voice_id, text: l.text });
      chars += characters;
      writeFileSync(OUT + `${l.id}.mp3`, buffer);
      // The same line over a 1940s voice-pipe/radio: narrow band, squashed, a little clipped, with hiss under it.
      try {
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', OUT + `${l.id}.mp3`, '-f', 'lavfi', '-i', 'anoisesrc=color=white:amplitude=0.01', '-filter_complex', '[0:a]highpass=f=420,lowpass=f=3000,acompressor=threshold=0.04:ratio=8:makeup=4,asoftclip=type=tanh[v];[v][1:a]amix=inputs=2:duration=first:normalize=0', OUT + `${l.id}-radio.mp3`]);
      } catch (e) {
        console.log('  (no radio version:', String(e.message).split('\n')[0], ')');
      }
      console.log(`  ${l.id}.mp3  (${v.name.split(' - ')[0]})  ${(buffer.length / 1024).toFixed(0)} KB  "${l.text}"`);
      log.push({ kind: 'voice', file: `${l.id}.mp3`, voice: v.name, voiceId: v.voice_id, model: 'eleven_multilingual_v2', text: l.text, characters });
    } catch (e) {
      console.log(`  ${l.id}: FAILED ${e.message}`);
      log.push({ kind: 'voice', id: l.id, error: e.message });
    }
  }
  console.log(`  ${chars} characters used`);
}

if (which === 'all' || which === 'images') await images();
if (which === 'all' || which === 'voices') await voices();
writeFileSync(OUT + `provenance-${which}.json`, JSON.stringify(log, null, 2));
console.log(`Written to assets-src/smoke/ (provenance-${which}.json logs the prompts, seeds and models).`);
