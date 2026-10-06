import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  // Relative asset paths so the production build loads correctly under the
  // file:// protocol when packaged in Electron (loadFile). Without this, Vite
  // emits absolute "/assets/..." URLs that resolve to the drive root and fail.
  base: './',
  // Share the single repository-root .env with the Python backend.
  envDir: '..',
  plugins: [react()],
})
