import { need } from './env.mjs';

const API = 'https://api.elevenlabs.io/v1';

export async function listVoices(env) {
  const r = await fetch(`${API}/voices`, { headers: { 'xi-api-key': need(env, 'ELEVENLABS_API_TOKEN') } });
  if (!r.ok) throw new Error(`ElevenLabs voices ${r.status}`);
  return (await r.json()).voices ?? [];
}

/** Speak a line. Returns { buffer, characters }. */
export async function speak(env, { voiceId, text, model = 'eleven_multilingual_v2', stability = 0.55, similarity = 0.8, style = 0.15 }) {
  const r = await fetch(`${API}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': need(env, 'ELEVENLABS_API_TOKEN'), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: model, voice_settings: { stability, similarity_boost: similarity, style, use_speaker_boost: true } }),
  });
  if (!r.ok) {
    let detail = '';
    try {
      detail = JSON.stringify((await r.json()).detail ?? '').slice(0, 300);
    } catch {
      /* not JSON */
    }
    throw new Error(`ElevenLabs speech ${r.status} ${detail}`);
  }
  return { buffer: Buffer.from(await r.arrayBuffer()), characters: text.length };
}

/**
 * Make a sound effect from a description. `duration` is seconds (0.5 to 30; omit to let it choose), `influence` how closely it keeps to the
 * words (0 to 1), `loop` asks for one that repeats without a seam. Returns { buffer }.
 */
export async function soundEffect(env, { text, duration, influence = 0.5, loop = false, model = 'eleven_text_to_sound_v2' }) {
  const body = { text, model_id: model, prompt_influence: influence };
  if (duration !== undefined) body.duration_seconds = duration;
  if (loop) body.loop = true;
  const r = await fetch(`${API}/sound-generation?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': need(env, 'ELEVENLABS_API_TOKEN'), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let detail = '';
    try {
      detail = JSON.stringify((await r.json()).detail ?? '').slice(0, 300);
    } catch {
      /* not JSON */
    }
    throw new Error(`ElevenLabs sound ${r.status} ${detail}`);
  }
  return { buffer: Buffer.from(await r.arrayBuffer()) };
}

