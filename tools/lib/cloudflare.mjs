import { need } from './env.mjs';

const API = 'https://api.cloudflare.com/client/v4';
/** The model for textures: FLUX.2 [klein] 4B, the Apache-2.0 one. */
export const KLEIN_4B = '@cf/black-forest-labs/flux-2-klein-4b';

let accountId = null;

async function account(env) {
  if (accountId) return accountId;
  const r = await fetch(`${API}/accounts`, { headers: { Authorization: `Bearer ${need(env, 'CLOUDFLARE_API_TOKEN')}` } });
  const j = await r.json();
  if (!j.success || !j.result?.length) throw new Error(`cannot find the Cloudflare account: ${JSON.stringify(j.errors)}`);
  accountId = j.result[0].id;
  return accountId;
}

/** Magic bytes of the picture, for the file extension. */
export function imageKind(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.subarray(0, 4).toString() === 'RIFF') return 'webp';
  return 'bin';
}

/** Make one picture. Returns { buffer, ext, ms }. `seed` makes it reproducible. */
export async function generateImage(env, { prompt, width = 1024, height = 1024, seed, model = KLEIN_4B }) {
  const id = await account(env);
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('width', String(width));
  form.append('height', String(height));
  if (seed !== undefined) form.append('seed', String(seed));
  const t0 = Date.now();
  const r = await fetch(`${API}/accounts/${id}/ai/run/${model}`, { method: 'POST', headers: { Authorization: `Bearer ${need(env, 'CLOUDFLARE_API_TOKEN')}` }, body: form });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`Cloudflare answered ${r.status} with something that is not JSON: ${text.slice(0, 200)}`);
  }
  const b64 = j.result?.image ?? j.image;
  if (!r.ok || !b64) throw new Error(`Cloudflare ${r.status}: ${JSON.stringify(j.errors ?? j).slice(0, 400)}`);
  const buffer = Buffer.from(b64, 'base64');
  return { buffer, ext: imageKind(buffer), ms: Date.now() - t0 };
}
