import * as net from 'net'
import * as fs from 'fs'
import { BrowserWindow, ipcMain } from 'electron'
import { processHookEvent } from './sessionManager'

export const SOCKET_PATH = '/tmp/claude-island.sock'

export interface HookEvent {
  session_id: string
  status?: string
  event?: string
  pid?: number
  tty?: string
  tool?: string
  tool_input?: unknown
  tool_use_id?: string
}

// Pending permission sockets keyed by session_id
const pendingPermissions = new Map<string, net.Socket>()

export function startSocketServer(getWindows: () => BrowserWindow[]): net.Server {
  // Remove stale socket file
  if (fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH)
  }

  const server = net.createServer((socket) => {
    let buffer = ''

    socket.on('data', (data) => {
      buffer += data.toString()

      // Parse newline-delimited JSON messages
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        try {
          const event = JSON.parse(trimmed) as HookEvent
          handleHookEvent(event, socket, getWindows)
        } catch {
          // Ignore malformed JSON
        }
      }
    })

    socket.on('error', () => {
      socket.destroy()
    })
  })

  server.listen(SOCKET_PATH, () => {
    // Socket server started
  })

  server.on('error', (err: Error) => {
    // Only log in development
    if (process.env['NODE_ENV'] !== 'production') {
      process.stderr.write(`Socket server error: ${err.message}\n`)
    }
  })

  // Handle permission responses from renderer via IPC
  ipcMain.on('permission-response', (_event, sessionId: string, decision: 'allow' | 'deny') => {
    const socket = pendingPermissions.get(sessionId)
    if (socket && !socket.destroyed) {
      socket.write(JSON.stringify({ decision }) + '\n')
      socket.end()
    }
    pendingPermissions.delete(sessionId)
  })

  // Handle permission timeout: close socket without sending decision (Claude Code falls back to terminal)
  ipcMain.on('permission-timeout', (_event, sessionId: string) => {
    const socket = pendingPermissions.get(sessionId)
    if (socket && !socket.destroyed) {
      socket.end()
    }
    pendingPermissions.delete(sessionId)
  })

  return server
}

function handleHookEvent(
  event: HookEvent,
  socket: net.Socket,
  getWindows: () => BrowserWindow[]
): void {
  const isPermissionRequest = event.event === 'PermissionRequest'

  if (isPermissionRequest && event.session_id) {
    // Keep connection open for PermissionRequest, awaiting { decision: 'allow'|'deny' }
    pendingPermissions.set(event.session_id, socket)

    socket.on('close', () => {
      pendingPermissions.delete(event.session_id)
    })
  }

  // Update session state based on event
  processHookEvent(event, getWindows)

  // Forward raw event to all renderer windows
  const windows = getWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send('hook-event', event)
    }
  }

  // Non-PermissionRequest events: close connection immediately
  if (!isPermissionRequest) {
    socket.end()
  }
}

export function cleanupSocketServer(): void {
  if (fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH)
  }
}
