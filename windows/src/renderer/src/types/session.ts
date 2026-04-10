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
