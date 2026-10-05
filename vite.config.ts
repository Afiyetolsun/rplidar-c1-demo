import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  // Disable Vite's implicit public-directory copy: no room files can enter a build.
  publicDir: false,
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: {
    host: '127.0.0.1', port: 5174, strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8788',
      '/ws': { target: 'ws://127.0.0.1:8788', ws: true }
    }
  }
});
