import { BrowserWindow } from 'electron'
import { HookEvent } from './socketServer'
import { updateTrayIcon } from './tray'

export type SessionPhase =
  | 'processing'
  | 'waitingForApproval'
  | 'waitingForInput'
  | 'idle'
  | 'ended'

export interface PendingTool {
  toolName: string
  toolInput: unknown
  toolUseId?: string
}

export interface SessionState {
  sessionId: string
  cwd: string
  phase: SessionPhase
  pid?: number
  pendingTool?: PendingTool
  lastMessage?: string
}

// Sessions keyed by sessionId
const sessions = new Map<string, SessionState>()

export function getSessions(): ReadonlyMap<string, SessionState> {
  return sessions
}

export function processHookEvent(event: HookEvent, getWindows: () => BrowserWindow[]): void {
  const { session_id } = event
  if (!session_id) return

  const eventType = event.event ?? event.status ?? ''

  switch (eventType) {
    case 'UserPromptSubmit':
    case 'PreToolUse': {
      const existing = sessions.get(session_id)
      const updated: SessionState = {
        sessionId: session_id,
        cwd: existing?.cwd ?? '',
        phase: 'processing',
        pid: event.pid ?? existing?.pid,
        pendingTool: existing?.pendingTool,
        lastMessage: existing?.lastMessage
      }
      sessions.set(session_id, updated)
      break
    }

    case 'PermissionRequest': {
      const existing = sessions.get(session_id)
      const updated: SessionState = {
        sessionId: session_id,
        cwd: existing?.cwd ?? '',
        phase: 'waitingForApproval',
        pid: event.pid ?? existing?.pid,
        pendingTool: {
          toolName: event.tool ?? '',
          toolInput: event.tool_input,
          toolUseId: event.tool_use_id
        },
        lastMessage: existing?.lastMessage
      }
      sessions.set(session_id, updated)
      break
    }

    case 'PostToolUse': {
      const existing = sessions.get(session_id)
      const updated: SessionState = {
        sessionId: session_id,
        cwd: existing?.cwd ?? '',
        phase: 'processing',
        pid: event.pid ?? existing?.pid,
        // Force clear waitingForApproval state (handles terminal manual approve)
        pendingTool: undefined,
        lastMessage: existing?.lastMessage
      }
      sessions.set(session_id, updated)
      break
    }

    case 'Stop': {
      const existing = sessions.get(session_id)
      if (!existing) return
      const updated: SessionState = {
        ...existing,
        phase: 'waitingForInput',
        pid: event.pid ?? existing.pid
      }
      sessions.set(session_id, updated)
      break
    }

    case 'SubagentStop': {
      // SubagentStop → processing (do NOT trigger completion notification)
      const existing = sessions.get(session_id)
      if (!existing) return
      const updated: SessionState = {
        ...existing,
        phase: 'processing',
        pid: event.pid ?? existing.pid
      }
      sessions.set(session_id, updated)
      break
    }

    case 'SessionStart': {
      // Initialize session state
      sessions.set(session_id, {
        sessionId: session_id,
        cwd: typeof event.tool_input === 'string' ? event.tool_input : '',
        phase: 'idle',
        pid: event.pid
      })
      break
    }

    case 'SessionEnd': {
      sessions.delete(session_id)
      break
    }

    default:
      // Unknown events: no state change
      return
  }

  // Broadcast updated session list to all renderer windows
  broadcastSessions(getWindows)
}

function broadcastSessions(getWindows: () => BrowserWindow[]): void {
  const sessionList = Array.from(sessions.values())
  const hasActiveSessions = sessionList.length > 0

  // Derive aggregate tray status from all sessions
  const hasApproval = sessionList.some(s => s.phase === 'waitingForApproval')
  const hasProcessing = sessionList.some(s => s.phase === 'processing')
  const trayStatus = hasApproval ? 'waitingForApproval' : hasProcessing ? 'processing' : 'idle'
  updateTrayIcon(trayStatus)

  for (const win of getWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send('sessions-updated', sessionList)
    // Show/hide window based on whether any sessions are active
    if (hasActiveSessions) {
      win.show()
    } else {
      win.hide()
    }
  }
}
