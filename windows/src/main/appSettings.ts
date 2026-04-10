import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { dirname } from 'path'

export interface AppSettings {
  startupEnabled: boolean
  notificationSound: 'none' | 'default'
}

const SETTINGS_PATH = join(app.getPath('userData'), 'settings.json')
const STARTUP_REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const STARTUP_VALUE_NAME = 'ClaudeIsland'

function defaults(): AppSettings {
  return { startupEnabled: false, notificationSound: 'default' }
}

export function loadSettings(): AppSettings {
  try {
    if (existsSync(SETTINGS_PATH)) {
      const raw = readFileSync(SETTINGS_PATH, 'utf-8')
      return { ...defaults(), ...(JSON.parse(raw) as Partial<AppSettings>) }
    }
  } catch {
    // ignore parse/read errors
  }
  return defaults()
}

export function saveSettings(settings: AppSettings): void {
  const dir = dirname(SETTINGS_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
}

export function getStartupEnabled(): boolean {
  if (process.platform !== 'win32') return false
  try {
    const out = execSync(
      `reg query "${STARTUP_REG_KEY}" /v ${STARTUP_VALUE_NAME}`,
      { stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString()
    return out.includes(STARTUP_VALUE_NAME)
  } catch {
    return false
  }
}

export function setStartupEnabled(enabled: boolean): void {
  if (process.platform !== 'win32') return
  const exePath = app.getPath('exe')
  if (enabled) {
    execSync(
      `reg add "${STARTUP_REG_KEY}" /v ${STARTUP_VALUE_NAME} /t REG_SZ /d "${exePath}" /f`,
      { stdio: 'ignore' }
    )
  } else {
    try {
      execSync(
        `reg delete "${STARTUP_REG_KEY}" /v ${STARTUP_VALUE_NAME} /f`,
        { stdio: 'ignore' }
      )
    } catch {
      // already absent — ignore
    }
  }
}
