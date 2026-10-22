import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The project's .env, read without a dependency and never printed. The asset tools use it; the game does not (nothing in the browser
 * bundle reads these keys, and Vite exposes only VITE_ variables).
 */
export function loadEnv(path = fileURLToPath(new URL('../../.env', import.meta.url))) {
  const env = {};
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    env[line.slice(0, i).replace(/^export\s+/, '').trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

export function need(env, name) {
  const v = env[name];
  if (!v) throw new Error(`${name} is missing from .env`);
  return v;
}
