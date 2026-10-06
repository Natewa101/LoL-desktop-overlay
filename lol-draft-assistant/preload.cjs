// Preload script (CommonJS).
// Runs in an isolated context before the renderer loads. With contextIsolation
// enabled and nodeIntegration disabled, the renderer cannot use `require` or
// touch `ipcRenderer` directly. We therefore expose a minimal, explicit bridge
// via contextBridge so the React app can request window-layout changes safely.
const { contextBridge, ipcRenderer } = require('electron');

// Whitelisted overlay modes the renderer is allowed to request.
const VALID_MODES = ['PRE_MATCH', 'POST_MATCH'];

contextBridge.exposeInMainWorld('electronAPI', {
  // Ask the main process to switch the window between the drafting dashboard
  // (PRE_MATCH) and the fullscreen in-game overlay (POST_MATCH).
  setOverlayMode: (mode) => {
    if (VALID_MODES.includes(mode)) {
      ipcRenderer.send('change-overlay-mode', mode);
    }
  },
  // Dynamically toggle window click-through. During the in-game overlay the
  // window ignores the mouse (clicks reach the game), but when the cursor is
  // over an interactive panel the renderer calls this with `ignore=false` so
  // the user can drag/close that panel, then `ignore=true` again on leave.
  setMouseIgnore: (ignore) => {
    ipcRenderer.send('set-mouse-ignore', !!ignore);
  },
  // Flag so the renderer can detect it is running inside Electron (vs a plain
  // browser tab / Vite preview) and skip IPC calls when it is not.
  isElectron: true,
});
