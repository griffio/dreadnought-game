// Make the sound effects in tools/sfx-prompts.json with ElevenLabs. Only those not yet made are made; delete a file to make it again.
//   node tools/sfx.mjs [id ...]        (no ids: every one that is missing)
// Writes assets-src/sounds/raw/elevenlabs/<id>.mp3 and logs how each was made in assets-src/sounds/elevenlabs-provenance.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { soundEffect } from './lib/elevenlabs.mjs';
import { loadEnv } from './lib/env.mjs';

const ROOT = fileURLToPath(new URL('../assets-src/sounds/', import.meta.url));
const OUT = ROOT + 'raw/elevenlabs/';
mkdirSync(OUT, { recursive: true });
const env = loadEnv();
const wanted = process.argv.slice(2);
const list = JSON.parse(readFileSync(fileURLToPath(new URL('./sfx-prompts.json', import.meta.url)), 'utf8')).sounds;
const logPath = ROOT + 'elevenlabs-provenance.json';
const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : [];

const todo = list.filter((s) => (wanted.length === 0 || wanted.includes(s.id)) && !existsSync(OUT + s.id + '.mp3'));
console.log(`${todo.length} to make of ${list.length}`);
let seconds = 0;
let next = 0;
async function worker() {
  while (next < todo.length) {
    const s = todo[next++];
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { buffer } = await soundEffect(env, { text: s.text, duration: s.duration, influence: s.influence, loop: s.loop });
        writeFileSync(OUT + s.id + '.mp3', buffer);
        seconds += s.duration ?? 0;
        log.push({ id: s.id, text: s.text, duration: s.duration, influence: s.influence, loop: !!s.loop, model: 'eleven_text_to_sound_v2', when: new Date().toISOString() });
        console.log(`  ${s.id.padEnd(20)} ${(buffer.length / 1024).toFixed(0)} KB`);
        break;
      } catch (e) {
        console.log(`  ${s.id} attempt ${attempt}: ${e.message}`);
        if (/ 40[13] /.test(e.message)) return; // no permission or no credits: stop
        await new Promise((r) => setTimeout(r, 2500 * attempt));
      }
    }
  }
}
await Promise.all([worker(), worker()]);
writeFileSync(logPath, JSON.stringify(log, null, 2));
console.log(`Done: ${seconds} seconds of sound requested.`);
