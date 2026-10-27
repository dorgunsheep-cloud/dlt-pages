import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset URLs work on username.github.io/project/ and custom domains.
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
});
