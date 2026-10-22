// Generate candidate images for the ship textures and decals with FLUX.2 [klein] 4B on Cloudflare Workers AI.
//   node tools/textures.mjs [id ...]      (no ids: every layer)
// Writes assets-src/textures/raw/<id>-<n>.jpg and appends what made each to assets-src/textures/provenance.json, so that any
// picture can be made again. The pictures are inputs: tools/process-textures.py turns the chosen ones into the game's atlases.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateImage, KLEIN_4B } from './lib/cloudflare.mjs';
import { loadEnv } from './lib/env.mjs';

const ROOT = fileURLToPath(new URL('../assets-src/textures/', import.meta.url));
mkdirSync(ROOT + 'raw', { recursive: true });
const env = loadEnv();

const FLAT = 'flat orthographic view, even diffuse lighting, no perspective, no cast shadows, no text, no people';
export const LAYERS = [
  { id: 'steel', n: 4, prompt: `seamless tileable texture of weathered painted grey steel hull plating, subtle panel lines, faint rows of rivets and light streaking, ${FLAT}` },
  { id: 'wear', n: 4, prompt: `seamless tileable texture of naval grey paint chipped and worn on steel, patches of red-brown rust and bare metal spread evenly across the whole image, ${FLAT}` },
  { id: 'streaks', n: 4, prompt: `seamless tileable grayscale mask of thin vertical rust drip streaks running down a steel wall, bright white streaks on a pure black background, ${FLAT}` },
  { id: 'grime', n: 4, prompt: `seamless tileable grayscale mask of dirty grime, soot and salt smudges, bright white marks on a pure black background, ${FLAT}` },
  { id: 'wood', n: 4, prompt: `seamless tileable texture of long weathered teak ship deck planks running horizontally with thin dark caulked seams, sun bleached grain, ${FLAT}` },
  { id: 'rivets', n: 3, prompt: `seamless tileable texture of riveted steel armour plates with bolted seams, painted dark grey, ${FLAT}` },
  { id: 'scorch', n: 5, prompt: `a soft irregular burn mark of soot spreading outward from a centre, organic and smoky with feathered edges, black soot on a pure white background, centred, ${FLAT}` },
  { id: 'hole', n: 6, prompt: `extreme close-up of a single ragged hole blown through grey steel plating by a shell, torn metal petals bent outward, charred scorching around the edge, the hole is pure black, centred and filling the frame, ${FLAT}` },
  { id: 'pit', n: 3, prompt: `a scatter of small shrapnel pits and scratches on grey steel, a few dark spots radiating outward from a centre, black marks on a pure white background, centred, ${FLAT}` },
];

const wanted = process.argv.slice(2);
const todo = LAYERS.filter((l) => wanted.length === 0 || wanted.includes(l.id));
const logPath = ROOT + 'provenance.json';
const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : [];

const jobs = todo.flatMap((l) => Array.from({ length: l.n }, (_, k) => ({ layer: l, k, seed: 7000 + 100 * LAYERS.indexOf(l) + k })));
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    const file = `raw/${job.layer.id}-${job.k + 1}.jpg`;
    if (existsSync(ROOT + file)) continue;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { buffer, ext, ms } = await generateImage(env, { prompt: job.layer.prompt, width: 1024, height: 1024, seed: job.seed });
        const out = file.replace(/\.jpg$/, `.${ext}`);
        writeFileSync(ROOT + out, buffer);
        log.push({ file: out, model: KLEIN_4B, prompt: job.layer.prompt, width: 1024, height: 1024, seed: job.seed, when: new Date().toISOString() });
        console.log(`${out}  ${(buffer.length / 1024).toFixed(0)} KB  ${(ms / 1000).toFixed(1)} s`);
        break;
      } catch (e) {
        console.log(`${file} attempt ${attempt}: ${e.message}`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
}
await Promise.all([worker(), worker(), worker()]);
writeFileSync(logPath, JSON.stringify(log, null, 2));
console.log(`Done: ${jobs.length} requested.`);
