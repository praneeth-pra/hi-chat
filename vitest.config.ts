import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'server', include: ['server/**/*.test.ts'], environment: 'node' }
      },
      {
        extends: true,
        test: { name: 'web', include: ['web/src/**/*.test.{ts,tsx}'], environment: 'jsdom' }
      }
    ]
  }
});
