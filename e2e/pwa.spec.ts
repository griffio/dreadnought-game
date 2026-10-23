import { expect, test } from './fixtures';

// The pieces that make the built game installable: the manifest with its icons, the icons themselves, and the service worker. The dev
// server serves them as the built site will (the worker is only registered by a built copy).
test('the manifest, icons and service worker are served and well formed', async ({ page }) => {
  await page.goto('/?menu=1&hud=0');
  const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
  expect(manifest.name).toBe('Fall of Shot');
  expect(manifest.start_url).toBe('/');
  expect(manifest.display).toBe('fullscreen');
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512']);
  for (const url of ['/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/sw.js', '/favicon.svg']) {
    const r = await page.evaluate(async (u) => {
      const res = await fetch(u);
      return { ok: res.ok, type: res.headers.get('content-type') ?? '', length: (await res.arrayBuffer()).byteLength };
    }, url);
    expect(r.ok, url).toBe(true);
    expect(r.length, url).toBeGreaterThan(200);
    if (url.endsWith('.png')) expect(r.type).toContain('image/png');
  }
  const sw = await page.evaluate(async () => (await fetch('/sw.js')).text());
  expect(sw).toContain("addEventListener('fetch'");
  expect(await page.evaluate(() => document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'))).toBe('/apple-touch-icon.png');
});
