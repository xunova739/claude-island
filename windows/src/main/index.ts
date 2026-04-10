import { app, BrowserWindow, shell, screen, ipcMain } from 'electron'
import { join } from 'path'
import { startSocketServer, cleanupSocketServer } from './socketServer'
import { createTray } from './tray'
import { focusTerminalByPid } from './focusTerminal'
import { getSessions } from './sessionManager'
import { getHookStatus, installHooks } from './hookInstaller'
import { loadSettings, saveSettings, getStartupEnabled, setStartupEnabled, AppSettings } from './appSettings'
import { checkForUpdate, downloadUpdate, installAndRelaunch } from './updater'

const COLLAPSED_WIDTH = 200
const COLLAPSED_HEIGHT = 32
const EXPANDED_WIDTH = 480
const EXPANDED_HEIGHT = 320

function centerWindowAtTop(win: BrowserWindow, width: number): void {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth } = primaryDisplay.workAreaSize
  win.setPosition(Math.floor((screenWidth - width) / 2), 0)
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: COLLAPSED_WIDTH,
    height: COLLAPSED_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  centerWindowAtTop(win, COLLAPSED_WIDTH)

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  const win = createWindow()

  // Handle window resize requests from renderer
  ipcMain.on('set-window-size', (_event, expanded: boolean) => {
    if (expanded) {
      win.setSize(EXPANDED_WIDTH, EXPANDED_HEIGHT)
      centerWindowAtTop(win, EXPANDED_WIDTH)
    } else {
      win.setSize(COLLAPSED_WIDTH, COLLAPSED_HEIGHT)
      centerWindowAtTop(win, COLLAPSED_WIDTH)
    }
  })

  // Handle focus-terminal requests from renderer
  ipcMain.on('focus-terminal', (_event, sessionId: string) => {
    const session = getSessions().get(sessionId)
    if (session?.pid != null) {
      focusTerminalByPid(session.pid)
    }
  })

  // Hook installer IPC handlers
  ipcMain.handle('get-hook-status', () => getHookStatus())
  ipcMain.handle('install-hooks', () => installHooks())

  // Settings IPC handlers
  ipcMain.handle('get-settings', () => {
    const settings = loadSettings()
    // Sync startupEnabled from registry at read time
    settings.startupEnabled = getStartupEnabled()
    return settings
  })
  ipcMain.handle('save-settings', (_event, settings: AppSettings) => {
    try {
      setStartupEnabled(settings.startupEnabled)
      saveSettings(settings)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Auto-updater IPC handlers
  ipcMain.handle('check-for-update', () => checkForUpdate())
  ipcMain.handle('download-update', async (_event, url: string) => {
    try {
      const installerPath = await downloadUpdate(url, (percent) => {
        win.webContents.send('update-progress', percent)
      })
      return { success: true, installerPath }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.on('install-and-relaunch', (_event, installerPath: string) => {
    installAndRelaunch(installerPath)
  })

  // Create system tray icon
  createTray(win)

  // Start Unix socket server, passing window getter for IPC forwarding
  startSocketServer(() => BrowserWindow.getAllWindows())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  cleanupSocketServer()
})
