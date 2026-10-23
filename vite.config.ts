import { defineConfig } from 'vitest/config';
import basicSsl from '@vitejs/plugin-basic-ssl';
import finishBuild from './tools/finish-build-plugin.mjs';
import perfResults from './tools/perf-results-plugin.mjs';

// WebGPU needs a secure context, so the dev server is HTTPS (self-signed) and bound to the LAN
// for iPad testing: open https://<mac-ip>:5173 and accept the certificate warning once. The perf-results plugin catches the Perf survey's
// report from the iPad (see tools/perf-results-plugin.mjs); finish-build prunes the asset tools' folders from a build and stamps the
// service worker.
export default defineConfig({
  plugins: [basicSsl(), perfResults(), finishBuild()],
  server: { host: true, port: 5173 },
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
