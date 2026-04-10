import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const HOOK_SCRIPT_NAME = 'claude-island-state.py'
const CLAUDE_DIR = join(homedir(), '.claude')
const HOOKS_DIR = join(CLAUDE_DIR, 'hooks')
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json')
const HOOK_SCRIPT_DEST = join(HOOKS_DIR, HOOK_SCRIPT_NAME)

const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Stop',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'Notification',
  'PreCompact',
  'UserPromptSubmit'
]

function getSourceScriptPath(): string {
  // In production, resources are at process.resourcesPath
  // In dev, use the ClaudeIsland/Resources path
  if (app.isPackaged) {
    return join(process.resourcesPath, HOOK_SCRIPT_NAME)
  }
  // Dev: relative to project root
  return join(app.getAppPath(), '..', 'ClaudeIsland', 'Resources', HOOK_SCRIPT_NAME)
}

export interface HookStatus {
  hooksConfigured: boolean
  scriptExists: boolean
}

export function getHookStatus(): HookStatus {
  const scriptExists = existsSync(HOOK_SCRIPT_DEST)

  let hooksConfigured = false
  if (existsSync(SETTINGS_PATH)) {
    try {
      const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')) as Record<string, unknown>
      const hooks = settings['hooks'] as Record<string, unknown> | undefined
      if (hooks) {
        // Check any hook event contains our script
        hooksConfigured = Object.values(hooks).some((eventHooks) => {
          if (!Array.isArray(eventHooks)) return false
          return eventHooks.some((entry: unknown) => {
            if (typeof entry !== 'object' || entry === null) return false
            const entryObj = entry as Record<string, unknown>
            const hookList = entryObj['hooks']
            if (!Array.isArray(hookList)) return false
            return hookList.some((h: unknown) => {
              if (typeof h !== 'object' || h === null) return false
              const cmd = (h as Record<string, unknown>)['command']
              return typeof cmd === 'string' && cmd.includes(HOOK_SCRIPT_NAME)
            })
          })
        })
      }
    } catch {
      // Malformed settings.json - treat as not configured
    }
  }

  return { hooksConfigured, scriptExists }
}

export function installHooks(): { success: boolean; error?: string } {
  try {
    // Ensure dirs exist
    if (!existsSync(CLAUDE_DIR)) {
      mkdirSync(CLAUDE_DIR, { recursive: true })
    }
    if (!existsSync(HOOKS_DIR)) {
      mkdirSync(HOOKS_DIR, { recursive: true })
    }

    // Copy script if missing
    if (!existsSync(HOOK_SCRIPT_DEST)) {
      const src = getSourceScriptPath()
      if (!existsSync(src)) {
        return { success: false, error: `Source script not found: ${src}` }
      }
      copyFileSync(src, HOOK_SCRIPT_DEST)
    }

    // Read or init settings.json
    let settings: Record<string, unknown> = {}
    if (existsSync(SETTINGS_PATH)) {
      try {
        settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')) as Record<string, unknown>
      } catch {
        // Malformed - start fresh
        settings = {}
      }
    }

    if (!settings['hooks'] || typeof settings['hooks'] !== 'object') {
      settings['hooks'] = {}
    }
    const hooks = settings['hooks'] as Record<string, unknown>

    const hookEntry = {
      matcher: '',
      hooks: [
        {
          type: 'command',
          command: `python3 "${HOOK_SCRIPT_DEST}"`
        }
      ]
    }

    for (const event of HOOK_EVENTS) {
      if (!Array.isArray(hooks[event])) {
        hooks[event] = []
      }
      const eventHooks = hooks[event] as unknown[]

      // Check if already added
      const alreadyAdded = eventHooks.some((entry: unknown) => {
        if (typeof entry !== 'object' || entry === null) return false
        const entryObj = entry as Record<string, unknown>
        const hookList = entryObj['hooks']
        if (!Array.isArray(hookList)) return false
        return hookList.some((h: unknown) => {
          if (typeof h !== 'object' || h === null) return false
          const cmd = (h as Record<string, unknown>)['command']
          return typeof cmd === 'string' && cmd.includes(HOOK_SCRIPT_NAME)
        })
      })

      if (!alreadyAdded) {
        eventHooks.push(hookEntry)
      }
    }

    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
