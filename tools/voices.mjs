// Make the crew's voice lines in tools/voice-lines.json with ElevenLabs. Only those not yet made are made; delete a file to make it again.
//   node tools/voices.mjs [id ...]        (no ids: every one that is missing)
// Writes assets-src/voices/raw/<id>.mp3 and logs how each was made in assets-src/voices/provenance.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listVoices, speak } from './lib/elevenlabs.mjs';
import { loadEnv } from './lib/env.mjs';

const ROOT = fileURLToPath(new URL('../assets-src/voices/', import.meta.url));
const OUT = ROOT + 'raw/';
mkdirSync(OUT, { recursive: true });
const env = loadEnv();
const wanted = process.argv.slice(2);
const doc = JSON.parse(readFileSync(fileURLToPath(new URL('./voice-lines.json', import.meta.url)), 'utf8'));
const logPath = ROOT + 'provenance.json';
const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : [];

const todo = doc.lines.filter((l) => (wanted.length === 0 || wanted.includes(l.id)) && !existsSync(OUT + l.id + '.mp3'));
console.log(`${todo.length} to make of ${doc.lines.length}`);
const voices = await listVoices(env);
const voiceFor = (role) => {
  const v = voices.find((x) => x.name.startsWith(doc.roles[role].voice));
  if (!v) throw new Error(`no voice called ${doc.roles[role].voice}`);
  return v;
};
let characters = 0;
for (const l of todo) {
  const role = doc.roles[l.role];
  const v = voiceFor(l.role);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await speak(env, { voiceId: v.voice_id, text: l.text, stability: role.stability, style: role.style });
      writeFileSync(OUT + l.id + '.mp3', r.buffer);
      characters += r.characters;
      log.push({ id: l.id, role: l.role, voice: v.name, voiceId: v.voice_id, model: 'eleven_multilingual_v2', stability: role.stability, style: role.style, text: l.text, characters: r.characters, when: new Date().toISOString() });
      console.log(`  ${l.id.padEnd(26)} ${v.name.split(' - ')[0].padEnd(8)} ${(r.buffer.length / 1024).toFixed(0).padStart(3)} KB  "${l.text}"`);
      break;
    } catch (e) {
      console.log(`  ${l.id} attempt ${attempt}: ${e.message}`);
      if (/ 40[13] /.test(e.message) || /quota/i.test(e.message)) {
        writeFileSync(logPath, JSON.stringify(log, null, 2));
        console.log(`Stopped: ${characters} characters used.`);
        process.exit(1);
      }
      await new Promise((res) => setTimeout(res, 2500 * attempt));
    }
  }
}
writeFileSync(logPath, JSON.stringify(log, null, 2));
console.log(`Done: ${characters} characters used.`);
