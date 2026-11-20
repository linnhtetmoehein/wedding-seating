import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// base './' = the built site works from any folder or GitHub Pages sub-path (e.g. /wedding-seating/)
export default defineConfig({ base: './', plugins: [react()], build: { chunkSizeWarningLimit: 2500 } });
