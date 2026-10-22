import { defineConfig } from 'vitest/config';
import basicSsl from '@vitejs/plugin-basic-ssl';

// WebGPU needs a secure context, so the dev server is HTTPS (self-signed) and bound to the LAN
// for iPad testing: open https://<mac-ip>:5173 and accept the certificate warning once.
export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true, port: 5173 },
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
