import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// sql.js ships a wasm file that must be served; we copy it to /public during build.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['sql.js'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
} as any);
