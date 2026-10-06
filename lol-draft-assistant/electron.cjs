// Electron main process entry point (CommonJS).
// Named .cjs because package.json sets "type": "module", which would otherwise
// treat .js files as ES modules and break require().
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { GlobalKeyboardListener } = require('node-global-key-listener');

// We run Electron elevated (as admin) so the native keyboard hook can intercept
// keys while the elevated game has focus. The Chromium sandbox cannot initialize
// under elevated privileges and fails the renderer launch with exitCode 18,
// producing a blank window. Disable the sandbox to allow the renderer to start.
app.commandLine.appendSwitch('no-sandbox');

// The Vite dev server URL used during development.
const DEV_SERVER_URL = process.env.ELECTRON_START_URL || 'http://localhost:5173';

let mainWindow = null;
// Handle to the bundled FastAPI backend (main.exe) spawned in production.
let backendProcess = null;

// In a packaged build, launch the frozen Python backend. electron-builder
// copies main.exe (via extraResources) next to the app under
// process.resourcesPath/bin/main.exe. In development we assume the backend is
// already running separately (e.g. `uvicorn main:app --reload`).
function startBackend() {
  if (!app.isPackaged) {
    console.log('[backend] dev mode: expecting an externally-run backend on :8000');
    return;
  }

  const backendPath = path.join(process.resourcesPath, 'bin', 'main.exe');
  console.log(`[backend] spawning bundled backend: ${backendPath}`);

  backendProcess = spawn(backendPath, [], {
    // Detached from any console; stdio piped so we can log backend output.
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout?.on('data', (d) => console.log(`[backend] ${d.toString().trim()}`));
  backendProcess.stderr?.on('data', (d) => console.error(`[backend] ${d.toString().trim()}`));
  backendProcess.on('error', (err) => console.error('[backend] failed to start:', err));
  backendProcess.on('exit', (code) => {
    console.log(`[backend] exited with code ${code}`);
    backendProcess = null;
  });
}

// Ensure the backend child process is terminated with the app.
function stopBackend() {
  if (backendProcess) {
    console.log('[backend] killing backend process');
    backendProcess.kill();
    backendProcess = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'LoL Draft Assistant',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      // Secure local context: keep Node out of the renderer and isolate
      // the page's JS from Electron internals. Renderer talks to the
      // FastAPI backend over plain HTTP fetch, so no Node access is needed.
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Sandbox must be off when running elevated (admin), otherwise the
      // renderer fails to launch with exitCode 18. Context isolation +
      // nodeIntegration:false still keep the renderer locked down.
      sandbox: false,
    },
  });

  // Surface fatal load/renderer failures in the terminal for debugging.
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[did-fail-load] ${code} ${desc} -> ${url}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[render-process-gone]', details);
  });

  if (app.isPackaged) {
    // Production: load the static build output. base: './' in vite.config.ts
    // ensures asset paths resolve correctly under the file:// protocol.
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
    // Development: load the live Vite dev server.
    mainWindow.loadURL(DEV_SERVER_URL);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Toggle overlay visibility without stealing focus from the game
function toggleOverlay() {
  if (!mainWindow) return;

  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.showInactive();
  }
}

// Re-shape the single window between the two layout phases.
//   PRE_MATCH  -> a centered 1200x800 drafting dashboard (grabbable, focusable).
//   POST_MATCH -> a fullscreen, click-through-friendly in-game overlay layer
//                 sized to the primary monitor's work area.
function setOverlayMode(mode) {
  if (!mainWindow) return;

  if (mode === 'PRE_MATCH') {
    mainWindow.setSize(1200, 800);
    mainWindow.center();
    mainWindow.setAlwaysOnTop(true);
    // Dashboard is interactive: the window must receive mouse events so the
    // user can click buttons, type, and drag the window.
    mainWindow.setIgnoreMouseEvents(false);
    if (!mainWindow.isVisible()) mainWindow.showInactive();
    console.log('[overlay-mode] PRE_MATCH -> 1200x800 interactive dashboard');
  } else if (mode === 'POST_MATCH') {
    // Cover the FULL primary display (including the area behind the taskbar) so
    // the overlay lines up with the fullscreen game. `bounds` (not
    // `workAreaSize`) gives the entire monitor, and its x/y anchor the window
    // to the correct display origin on multi-monitor setups.
    const { x, y, width, height } = screen.getPrimaryDisplay().bounds;
    mainWindow.setBounds({ x, y, width, height });
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    // Click-through: the informational overlay stays visible on top of the game
    // but every mouse click/move passes straight through to League beneath it,
    // so the player can keep controlling their champion normally.
    // `forward: true` still forwards move events so CSS :hover can work if ever
    // needed, without capturing clicks.
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    if (!mainWindow.isVisible()) mainWindow.showInactive();
    console.log(`[overlay-mode] POST_MATCH -> ${width}x${height} click-through overlay`);
  }
}

// Renderer requests a layout change over the contextBridge IPC channel.
ipcMain.on('change-overlay-mode', (_event, mode) => {
  setOverlayMode(mode);
});

// Renderer toggles click-through on the fly (e.g. cursor entered/left an
// interactive overlay panel). `forward: true` keeps mouse-move events flowing
// to the page so it can keep detecting hover even while ignoring clicks.
ipcMain.on('set-mouse-ignore', (_event, ignore) => {
  if (!mainWindow) return;
  mainWindow.setIgnoreMouseEvents(!!ignore, { forward: true });
});

// Register the global keyboard shortcut using a native OS-level keyboard hook.
// Unlike Electron's globalShortcut, this uses Windows low-level hooks (WH_KEYBOARD_LL)
// which continue to fire even when an elevated/fullscreen DirectX game has focus.
let keyboardListener = null;

function registerShortcut() {
  keyboardListener = new GlobalKeyboardListener();

  // Listen for Ctrl+Shift+O at the OS level.
  // `down` is a map of currently-held keys keyed by their standard name.
  keyboardListener.addListener((e, down) => {
    if (
      e.state === 'DOWN' &&
      e.name === 'O' &&
      (down['LEFT CTRL'] || down['RIGHT CTRL']) &&
      (down['LEFT SHIFT'] || down['RIGHT SHIFT'])
    ) {
      toggleOverlay();
    }
  }).then(() => {
    console.log('[shortcut] registered Ctrl+Shift+O (native OS-level hook)');
  }).catch((err) => {
    console.error('[shortcut] failed to register global keyboard hook:', err);
  });
}

// Unregister the global keyboard shortcut and destroy the key server.
// Wrapped in try/catch: on app exit node-global-key-listener can tear down its
// child key-server process before kill() runs, leaving an undefined handle and
// throwing "Cannot read properties of undefined (reading 'stdout')".
function unregisterShortcut() {
  try {
    if (keyboardListener) {
      keyboardListener.kill();
    }
  } catch (err) {
    console.error('[shortcut] error shutting down keyboard listener:', err);
  } finally {
    keyboardListener = null;
  }
}

// Electron is ready -> create the window.
app.whenReady().then(() => {
  console.log(
    `[app] LoL Draft Assistant v${app.getVersion()} starting ` +
      `(${app.isPackaged ? 'production' : 'development'}, electron ${process.versions.electron}, ${process.platform})`
  );
  startBackend();
  createWindow();
  registerShortcut();

  // macOS: re-create a window when the dock icon is clicked and none are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS where apps stay active.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    unregisterShortcut();
    app.quit();
  }
});

app.on('before-quit', () => {
  unregisterShortcut();
});

// Final cleanup: make sure the bundled backend is not left running.
app.on('will-quit', () => {
  stopBackend();
});
