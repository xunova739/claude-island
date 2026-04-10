import React, { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { SessionPhase, SessionState } from './types/session'

interface HookStatus {
  hooksConfigured: boolean
  scriptExists: boolean
}

interface AppSettings {
  startupEnabled: boolean
  notificationSound: 'none' | 'default'
}

type UpdateStatus = 'idle' | 'checking' | 'found' | 'downloading' | 'readyToInstall' | 'installing'

interface UpdateInfo {
  version: string
  downloadUrl: string
  publishedAt: string
  size: number
}

const COLLAPSED_WIDTH = 200
const COLLAPSED_HEIGHT = 32
const EXPANDED_WIDTH = 480
const EXPANDED_HEIGHT = 320
const PERMISSION_COUNTDOWN = 10
const COMPLETION_COUNTDOWN = 10
const AUTO_COLLAPSE_DELAY = 5000

const hudStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  background: 'rgba(15,15,15,0.92)',
  borderRadius: '16px',
  color: '#fff',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontSize: '13px',
  userSelect: 'none',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column'
}

const collapsedBarStyle: React.CSSProperties = {
  height: `${COLLAPSED_HEIGHT}px`,
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '0 16px',
  flexShrink: 0
}

function getSessionDotColor(sessions: SessionState[]): string {
  if (sessions.some((s) => s.phase === 'waitingForApproval')) return '#f59e0b'
  if (sessions.some((s) => s.phase === 'processing')) return '#f97316'
  if (sessions.some((s) => s.phase === 'waitingForInput')) return '#22c55e'
  if (sessions.length > 0) return '#6b7280'
  return '#374151'
}

function phaseOrder(phase: SessionPhase): number {
  switch (phase) {
    case 'waitingForApproval': return 0
    case 'waitingForInput': return 1
    case 'processing': return 2
    case 'idle': return 3
    default: return 4
  }
}

function sortSessions(sessions: SessionState[]): SessionState[] {
  return [...sessions].sort((a, b) => phaseOrder(a.phase) - phaseOrder(b.phase))
}

function getProjectName(cwd: string): string {
  if (!cwd) return 'Unknown'
  const parts = cwd.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || parts[parts.length - 2] || cwd
}

function renderToolInputPreview(toolInput: unknown): string[] {
  if (!toolInput) return []
  if (typeof toolInput === 'string') {
    return [toolInput.slice(0, 120)]
  }
  if (typeof toolInput === 'object' && toolInput !== null) {
    return Object.entries(toolInput as Record<string, unknown>)
      .slice(0, 3)
      .map(([k, v]) => {
        const val = typeof v === 'string' ? v : JSON.stringify(v)
        return `${k}: ${val}`.slice(0, 120)
      })
  }
  return []
}

interface StatusIconProps {
  phase: SessionPhase
}

function StatusIcon({ phase }: StatusIconProps): React.ReactElement {
  switch (phase) {
    case 'processing':
      return (
        <span
          className="spin"
          style={{ fontSize: '14px', color: '#f97316', lineHeight: 1 }}
        >
          ◐
        </span>
      )
    case 'waitingForApproval':
      return (
        <span
          style={{
            fontSize: '14px',
            color: '#f59e0b',
            lineHeight: 1,
            fontWeight: 'bold'
          }}
        >
          !
        </span>
      )
    case 'waitingForInput':
      return (
        <span style={{ fontSize: '14px', color: '#22c55e', lineHeight: 1 }}>
          ✓
        </span>
      )
    case 'idle':
    default:
      return (
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#6b7280',
            verticalAlign: 'middle'
          }}
        />
      )
  }
}

interface SessionRowProps {
  session: SessionState
  onClick: (sessionId: string) => void
}

function SessionRow({ session, onClick }: SessionRowProps): React.ReactElement {
  const projectName = getProjectName(session.cwd)

  return (
    <div
      onClick={() => onClick(session.sessionId)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 8px',
        borderRadius: '8px',
        marginBottom: '4px',
        background: 'rgba(255,255,255,0.05)',
        cursor: 'pointer',
        transition: 'background 0.15s'
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.1)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.05)'
      }}
    >
      <div style={{ flexShrink: 0, width: 16, textAlign: 'center' }}>
        <StatusIcon phase={session.phase} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '12px',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {projectName}
        </div>
        {session.lastMessage && (
          <div
            style={{
              fontSize: '11px',
              opacity: 0.55,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 1,
              WebkitBoxOrient: 'vertical',
              wordBreak: 'break-word'
            }}
          >
            {session.lastMessage}
          </div>
        )}
      </div>
    </div>
  )
}

interface PermissionCardProps {
  session: SessionState
  pendingCount: number
  isHovered: boolean
  onAllow: (sessionId: string) => void
  onDeny: (sessionId: string) => void
  onAllowAll: (sessionId: string) => void
  onTimeout: (sessionId: string) => void
}

function PermissionCard({
  session,
  pendingCount,
  isHovered,
  onAllow,
  onDeny,
  onAllowAll,
  onTimeout
}: PermissionCardProps): React.ReactElement {
  const [countdown, setCountdown] = useState(PERMISSION_COUNTDOWN)
  const timedOutRef = useRef(false)

  useEffect(() => {
    setCountdown(PERMISSION_COUNTDOWN)
    timedOutRef.current = false
  }, [session.sessionId])

  useEffect(() => {
    if (isHovered) return
    if (countdown <= 0) {
      if (!timedOutRef.current) {
        timedOutRef.current = true
        onTimeout(session.sessionId)
      }
      return
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown, isHovered, session.sessionId, onTimeout])

  const tool = session.pendingTool
  const toolName = tool?.toolName ?? ''
  const toolPreviews = tool ? renderToolInputPreview(tool.toolInput) : []
  const projectName = getProjectName(session.cwd)

  return (
    <div
      style={{
        margin: '8px 8px 4px',
        padding: '12px',
        background: 'rgba(245,158,11,0.08)',
        border: '1px solid rgba(245,158,11,0.3)',
        borderRadius: '12px',
        flexShrink: 0
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '8px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          <span style={{ fontSize: '13px', color: '#f59e0b', fontWeight: 600 }}>!</span>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {projectName}
          </span>
          {pendingCount > 0 && (
            <span
              style={{
                fontSize: '10px',
                background: 'rgba(245,158,11,0.3)',
                color: '#f59e0b',
                borderRadius: '10px',
                padding: '1px 5px',
                flexShrink: 0
              }}
            >
              +{pendingCount}
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: '11px',
            opacity: isHovered ? 0.4 : 0.7,
            flexShrink: 0,
            marginLeft: '8px'
          }}
        >
          {isHovered ? 'paused' : `${countdown}s`}
        </span>
      </div>

      <div style={{ marginBottom: '6px' }}>
        <span
          style={{
            fontSize: '12px',
            color: '#f59e0b',
            fontFamily: 'monospace',
            background: 'rgba(245,158,11,0.1)',
            padding: '1px 6px',
            borderRadius: '4px'
          }}
        >
          {toolName || 'unknown'}
        </span>
      </div>

      {toolPreviews.length > 0 && (
        <div style={{ marginBottom: '10px' }}>
          {toolPreviews.map((line, i) => (
            <div
              key={i}
              style={{
                fontSize: '11px',
                opacity: 0.6,
                fontFamily: 'monospace',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                marginBottom: i < toolPreviews.length - 1 ? '2px' : 0
              }}
            >
              {line}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          onClick={() => onDeny(session.sessionId)}
          style={{
            flex: 1,
            padding: '5px 8px',
            fontSize: '11px',
            borderRadius: '6px',
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.06)',
            color: '#fff',
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.12)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'
          }}
        >
          Deny
        </button>
        <button
          onClick={() => onAllow(session.sessionId)}
          style={{
            flex: 1,
            padding: '5px 8px',
            fontSize: '11px',
            borderRadius: '6px',
            border: '1px solid rgba(255,255,255,0.3)',
            background: 'rgba(255,255,255,0.12)',
            color: '#fff',
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.2)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.12)'
          }}
        >
          Allow
        </button>
        <button
          onClick={() => onAllowAll(session.sessionId)}
          style={{
            flex: 1,
            padding: '5px 8px',
            fontSize: '11px',
            borderRadius: '6px',
            border: '1px solid rgba(245,158,11,0.5)',
            background: 'rgba(245,158,11,0.15)',
            color: '#f59e0b',
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,158,11,0.25)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,158,11,0.15)'
          }}
        >
          Allow All
        </button>
      </div>
    </div>
  )
}

interface SettingsPanelProps {
  onClose: () => void
}

function ToggleSwitch({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (v: boolean) => void
}): React.ReactElement {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: 32,
        height: 18,
        borderRadius: 9,
        background: checked ? '#22c55e' : 'rgba(255,255,255,0.15)',
        cursor: 'pointer',
        position: 'relative',
        flexShrink: 0,
        transition: 'background 0.2s'
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 14 : 2,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.2s'
        }}
      />
    </div>
  )
}

function SettingsPanel({ onClose }: SettingsPanelProps): React.ReactElement {
  const [hookStatus, setHookStatus] = useState<HookStatus | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const installerPathRef = useRef<string | null>(null)

  const loadStatus = useCallback(async () => {
    const status = (await window.electron.ipcRenderer.invoke('get-hook-status')) as HookStatus
    setHookStatus(status)
  }, [])

  const loadSettings = useCallback(async () => {
    const s = (await window.electron.ipcRenderer.invoke('get-settings')) as AppSettings
    setSettings(s)
  }, [])

  useEffect(() => {
    void loadStatus()
    void loadSettings()
  }, [loadStatus, loadSettings])

  const persistSettings = useCallback(async (next: AppSettings) => {
    setSaving(true)
    await window.electron.ipcRenderer.invoke('save-settings', next)
    setSaving(false)
  }, [])

  const handleStartupToggle = useCallback((enabled: boolean) => {
    const next: AppSettings = { ...(settings ?? { startupEnabled: false, notificationSound: 'default' }), startupEnabled: enabled }
    setSettings(next)
    void persistSettings(next)
  }, [settings, persistSettings])

  const handleSoundChange = useCallback((sound: 'none' | 'default') => {
    const next: AppSettings = { ...(settings ?? { startupEnabled: false, notificationSound: 'default' }), notificationSound: sound }
    setSettings(next)
    void persistSettings(next)
  }, [settings, persistSettings])

  const handleInstall = useCallback(async () => {
    setInstalling(true)
    setInstallError(null)
    const result = (await window.electron.ipcRenderer.invoke('install-hooks')) as {
      success: boolean
      error?: string
    }
    setInstalling(false)
    if (result.success) {
      await loadStatus()
    } else {
      setInstallError(result.error ?? 'Unknown error')
    }
  }, [loadStatus])

  // Update progress listener
  useEffect(() => {
    window.electron.ipcRenderer.on('update-progress', (...args: unknown[]) => {
      const percent = args[0] as number
      setDownloadProgress(percent)
      if (percent >= 100) {
        setUpdateStatus('readyToInstall')
      }
    })
    return () => {
      window.electron.ipcRenderer.removeAllListeners('update-progress')
    }
  }, [])

  const handleCheckUpdate = useCallback(async () => {
    setUpdateStatus('checking')
    const info = (await window.electron.ipcRenderer.invoke('check-for-update')) as UpdateInfo | null
    if (info) {
      setUpdateInfo(info)
      setUpdateStatus('found')
    } else {
      setUpdateStatus('idle')
    }
  }, [])

  const handleDownloadUpdate = useCallback(async () => {
    if (!updateInfo) return
    setUpdateStatus('downloading')
    setDownloadProgress(0)
    const result = (await window.electron.ipcRenderer.invoke(
      'download-update',
      updateInfo.downloadUrl
    )) as { success: boolean; installerPath?: string; error?: string }
    if (result.success && result.installerPath) {
      installerPathRef.current = result.installerPath
      setUpdateStatus('readyToInstall')
    } else {
      setUpdateStatus('found')
    }
  }, [updateInfo])

  const handleInstallAndRelaunch = useCallback(() => {
    if (!installerPathRef.current) return
    setUpdateStatus('installing')
    window.electron.ipcRenderer.send('install-and-relaunch', installerPathRef.current)
  }, [])

  const installed = hookStatus?.hooksConfigured && hookStatus?.scriptExists

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: '1px solid rgba(255,255,255,0.06)'
  }

  const labelStyle: React.CSSProperties = { fontSize: '12px', opacity: 0.85 }

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(15,15,15,0.98)',
        borderRadius: '16px',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        overflowY: 'auto'
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '14px',
          flexShrink: 0
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 600 }}>设置{saving ? ' …' : ''}</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.5)',
            cursor: 'pointer',
            fontSize: '16px',
            lineHeight: 1,
            padding: '2px 6px'
          }}
        >
          ✕
        </button>
      </div>

      {/* Startup section */}
      <div
        style={{
          background: 'rgba(255,255,255,0.05)',
          borderRadius: '10px',
          padding: '10px 12px',
          marginBottom: '10px'
        }}
      >
        <div style={rowStyle}>
          <span style={labelStyle}>开机自启</span>
          <ToggleSwitch
            checked={settings?.startupEnabled ?? false}
            onChange={handleStartupToggle}
          />
        </div>
        <div style={{ ...rowStyle, borderBottom: 'none' }}>
          <span style={labelStyle}>通知声音</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['none', 'default'] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => handleSoundChange(opt)}
                style={{
                  padding: '3px 10px',
                  fontSize: '11px',
                  borderRadius: '5px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: settings?.notificationSound === opt
                    ? 'rgba(255,255,255,0.2)'
                    : 'rgba(255,255,255,0.05)',
                  color: settings?.notificationSound === opt ? '#fff' : 'rgba(255,255,255,0.5)',
                  cursor: 'pointer'
                }}
              >
                {opt === 'none' ? '无声' : '默认'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Hook status section */}
      <div
        style={{
          background: 'rgba(255,255,255,0.05)',
          borderRadius: '10px',
          padding: '12px'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '8px'
          }}
        >
          <span style={{ fontSize: '12px', fontWeight: 500 }}>Claude Code Hook</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: hookStatus === null ? '#6b7280' : installed ? '#22c55e' : '#ef4444',
                flexShrink: 0
              }}
            />
            <span style={{ fontSize: '11px', opacity: 0.6 }}>
              {hookStatus === null ? '检查中…' : installed ? '已安装' : '未安装'}
            </span>
          </div>
        </div>

        {hookStatus && !installed && (
          <>
            {!hookStatus.scriptExists && (
              <div style={{ fontSize: '11px', opacity: 0.5, marginBottom: '8px' }}>
                脚本未复制至 ~/.claude/hooks/
              </div>
            )}
            {!hookStatus.hooksConfigured && (
              <div style={{ fontSize: '11px', opacity: 0.5, marginBottom: '8px' }}>
                ~/.claude/settings.json 未配置 hooks
              </div>
            )}
            <button
              onClick={() => { void handleInstall() }}
              disabled={installing}
              style={{
                width: '100%',
                padding: '6px 12px',
                fontSize: '11px',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.2)',
                background: installing ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)',
                color: installing ? 'rgba(255,255,255,0.4)' : '#fff',
                cursor: installing ? 'default' : 'pointer',
                marginTop: '4px'
              }}
            >
              {installing ? '安装中…' : '自动安装 Hook'}
            </button>
            {installError && (
              <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '6px', wordBreak: 'break-all' }}>
                {installError}
              </div>
            )}
          </>
        )}
      </div>

      {/* Update section */}
      <div
        style={{
          background: 'rgba(255,255,255,0.05)',
          borderRadius: '10px',
          padding: '12px',
          marginTop: '10px'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: updateStatus === 'idle' || updateStatus === 'checking' ? 0 : '10px'
          }}
        >
          <span style={{ fontSize: '12px', fontWeight: 500 }}>应用更新</span>
          {(updateStatus === 'idle' || updateStatus === 'checking') && (
            <button
              onClick={() => { void handleCheckUpdate() }}
              disabled={updateStatus === 'checking'}
              style={{
                padding: '3px 10px',
                fontSize: '11px',
                borderRadius: '5px',
                border: '1px solid rgba(255,255,255,0.2)',
                background: updateStatus === 'checking' ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)',
                color: updateStatus === 'checking' ? 'rgba(255,255,255,0.4)' : '#fff',
                cursor: updateStatus === 'checking' ? 'default' : 'pointer'
              }}
            >
              {updateStatus === 'checking' ? '检查中…' : '检查更新'}
            </button>
          )}
        </div>

        {(updateStatus === 'found' || updateStatus === 'downloading' || updateStatus === 'readyToInstall' || updateStatus === 'installing') && updateInfo && (
          <>
            <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '8px' }}>
              版本：{updateInfo.version}
            </div>
            {updateStatus === 'downloading' && (
              <>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: 'rgba(255,255,255,0.1)',
                    overflow: 'hidden',
                    marginBottom: '6px'
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${downloadProgress}%`,
                      background: '#3b82f6',
                      borderRadius: 3,
                      transition: 'width 0.2s'
                    }}
                  />
                </div>
                <div style={{ fontSize: '11px', opacity: 0.5, marginBottom: '8px' }}>
                  {downloadProgress}%
                </div>
              </>
            )}
            {updateStatus === 'found' && (
              <button
                onClick={() => { void handleDownloadUpdate() }}
                style={{
                  width: '100%',
                  padding: '6px 12px',
                  fontSize: '11px',
                  borderRadius: '6px',
                  border: '1px solid rgba(59,130,246,0.5)',
                  background: 'rgba(59,130,246,0.15)',
                  color: '#3b82f6',
                  cursor: 'pointer'
                }}
              >
                Download Update
              </button>
            )}
            {(updateStatus === 'readyToInstall' || updateStatus === 'installing') && (
              <button
                onClick={handleInstallAndRelaunch}
                disabled={updateStatus === 'installing'}
                style={{
                  width: '100%',
                  padding: '6px 12px',
                  fontSize: '11px',
                  borderRadius: '6px',
                  border: 'none',
                  background: updateStatus === 'installing' ? 'rgba(255,255,255,0.1)' : '#fff',
                  color: updateStatus === 'installing' ? 'rgba(255,255,255,0.4)' : '#000',
                  cursor: updateStatus === 'installing' ? 'default' : 'pointer',
                  fontWeight: 500
                }}
              >
                {updateStatus === 'installing' ? '安装中…' : 'Install & Relaunch'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

interface CompletionCardProps {
  session: SessionState
  isHovered: boolean
  onClose: (sessionId: string) => void
  onFocusTerminal: (sessionId: string) => void
}

function CompletionCard({
  session,
  isHovered,
  onClose,
  onFocusTerminal
}: CompletionCardProps): React.ReactElement {
  const [countdown, setCountdown] = useState(COMPLETION_COUNTDOWN)
  const timedOutRef = useRef(false)

  useEffect(() => {
    setCountdown(COMPLETION_COUNTDOWN)
    timedOutRef.current = false
  }, [session.sessionId])

  useEffect(() => {
    if (isHovered) return
    if (countdown <= 0) {
      if (!timedOutRef.current) {
        timedOutRef.current = true
        onClose(session.sessionId)
      }
      return
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown, isHovered, session.sessionId, onClose])

  const projectName = getProjectName(session.cwd)

  return (
    <div
      style={{
        margin: '8px 8px 4px',
        padding: '12px',
        background: 'rgba(34,197,94,0.08)',
        border: '1px solid rgba(34,197,94,0.3)',
        borderRadius: '12px',
        flexShrink: 0
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '8px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          <span style={{ fontSize: '14px', color: '#22c55e', lineHeight: 1 }}>✓</span>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#22c55e', flexShrink: 0 }}>
            任务完成
          </span>
          <span
            style={{
              fontSize: '12px',
              opacity: 0.6,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            · {projectName}
          </span>
        </div>
        <span
          style={{
            fontSize: '11px',
            opacity: isHovered ? 0.4 : 0.7,
            flexShrink: 0,
            marginLeft: '8px'
          }}
        >
          {isHovered ? 'paused' : `${countdown}s`}
        </span>
      </div>

      {/* Last message */}
      {session.lastMessage && (
        <div
          style={{
            fontSize: '11px',
            opacity: 0.7,
            marginBottom: '10px',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            wordBreak: 'break-word'
          }}
        >
          {session.lastMessage}
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          onClick={() => onClose(session.sessionId)}
          style={{
            flex: 1,
            padding: '5px 8px',
            fontSize: '11px',
            borderRadius: '6px',
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.06)',
            color: '#fff',
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.12)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'
          }}
        >
          关闭
        </button>
        <button
          onClick={() => onFocusTerminal(session.sessionId)}
          style={{
            flex: 1,
            padding: '5px 8px',
            fontSize: '11px',
            borderRadius: '6px',
            border: 'none',
            background: '#fff',
            color: '#000',
            cursor: 'pointer',
            fontWeight: 500
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.85)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = '#fff'
          }}
        >
          跳转终端
        </button>
      </div>
    </div>
  )
}

const App: React.FC = () => {
  const [sessions, setSessions] = useState<SessionState[]>([])
  const [expanded, setExpanded] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [autoApproveSessions, setAutoApproveSessions] = useState<Set<string>>(new Set())
  // Queue of sessionIds awaiting completion notification
  const [completionSessionIds, setCompletionSessionIds] = useState<string[]>([])

  // Track previous phase per session to detect transitions
  const prevPhaseRef = useRef<Map<string, SessionPhase>>(new Map())

  const pendingApproval = sessions.filter((s) => s.phase === 'waitingForApproval')
  const currentApproval = pendingApproval[0] ?? null
  const extraPendingCount = Math.max(0, pendingApproval.length - 1)

  const autoApproveRef = useRef<Set<string>>(autoApproveSessions)
  autoApproveRef.current = autoApproveSessions
  const processedAutoApproveRef = useRef<Set<string>>(new Set())

  // Auto-approve logic
  useEffect(() => {
    if (!currentApproval) return
    const { sessionId } = currentApproval
    if (
      autoApproveRef.current.has(sessionId) &&
      !processedAutoApproveRef.current.has(sessionId)
    ) {
      processedAutoApproveRef.current.add(sessionId)
      window.electron.ipcRenderer.send('permission-response', sessionId, 'allow')
    }
  }, [currentApproval])

  // Subscribe to sessions updates
  useEffect(() => {
    window.electron.ipcRenderer.on('sessions-updated', (...args: unknown[]) => {
      const sessionList = args[0] as SessionState[]
      setSessions(sessionList)
      if (sessionList.length === 0) {
        setExpanded(false)
      }
    })
    return () => {
      window.electron.ipcRenderer.removeAllListeners('sessions-updated')
    }
  }, [])

  // Detect waitingForInput transitions for completion notifications
  useEffect(() => {
    const newCompletionIds: string[] = []
    for (const session of sessions) {
      const prevPhase = prevPhaseRef.current.get(session.sessionId)
      // Only fire if we've seen this session before (prevPhase exists) and it just transitioned
      if (
        session.phase === 'waitingForInput' &&
        prevPhase !== undefined &&
        prevPhase !== 'waitingForInput'
      ) {
        newCompletionIds.push(session.sessionId)
      }
    }

    // Update the phase map
    const newMap = new Map<string, SessionPhase>()
    for (const session of sessions) {
      newMap.set(session.sessionId, session.phase)
    }
    prevPhaseRef.current = newMap

    const activeIds = new Set(sessions.map((s) => s.sessionId))

    setCompletionSessionIds((prev) => {
      // Remove sessions that have ended
      const filtered = prev.filter((id) => activeIds.has(id))
      // Add newly transitioned sessions (dedup)
      const existing = new Set(filtered)
      const toAdd = newCompletionIds.filter((id) => !existing.has(id))
      return [...filtered, ...toAdd]
    })

    if (newCompletionIds.length > 0) {
      setExpanded(true)
    }
  }, [sessions])

  // Auto-expand when there's a waitingForApproval session (not auto-approved)
  useEffect(() => {
    if (
      currentApproval &&
      !autoApproveRef.current.has(currentApproval.sessionId)
    ) {
      setExpanded(true)
    }
  }, [currentApproval])

  // 5-second auto-collapse when mouse leaves (inhibited while notification cards are shown)
  const autoCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Inline-compute whether notification cards are active (same logic as render)
    const pendingApprovalSessions = sessions.filter((s) => s.phase === 'waitingForApproval')
    const firstApproval = pendingApprovalSessions[0] ?? null
    const hasPermissionCard = firstApproval !== null && !autoApproveRef.current.has(firstApproval.sessionId)
    const firstCompletionId = completionSessionIds[0] ?? null
    const hasCompletionCard = firstCompletionId !== null && sessions.some((s) => s.sessionId === firstCompletionId)
    const hasActiveCards = hasPermissionCard || hasCompletionCard

    if (!expanded || hasActiveCards) {
      if (autoCollapseTimerRef.current) {
        clearTimeout(autoCollapseTimerRef.current)
        autoCollapseTimerRef.current = null
      }
      return
    }
    if (isHovered) {
      if (autoCollapseTimerRef.current) {
        clearTimeout(autoCollapseTimerRef.current)
        autoCollapseTimerRef.current = null
      }
    } else {
      autoCollapseTimerRef.current = setTimeout(() => {
        setExpanded(false)
      }, AUTO_COLLAPSE_DELAY)
    }
    return () => {
      if (autoCollapseTimerRef.current) {
        clearTimeout(autoCollapseTimerRef.current)
        autoCollapseTimerRef.current = null
      }
    }
  }, [isHovered, expanded, sessions, completionSessionIds])

  // Sync window size with expanded state
  useEffect(() => {
    window.electron.ipcRenderer.send('set-window-size', expanded)
  }, [expanded])

  const handleSessionClick = useCallback((sessionId: string): void => {
    window.electron.ipcRenderer.send('focus-terminal', sessionId)
  }, [])

  const handleAllow = useCallback((sessionId: string): void => {
    processedAutoApproveRef.current.add(sessionId)
    window.electron.ipcRenderer.send('permission-response', sessionId, 'allow')
  }, [])

  const handleDeny = useCallback((sessionId: string): void => {
    processedAutoApproveRef.current.add(sessionId)
    window.electron.ipcRenderer.send('permission-response', sessionId, 'deny')
  }, [])

  const handleAllowAll = useCallback((sessionId: string): void => {
    processedAutoApproveRef.current.add(sessionId)
    setAutoApproveSessions((prev) => new Set([...prev, sessionId]))
    window.electron.ipcRenderer.send('permission-response', sessionId, 'allow')
  }, [])

  const handleTimeout = useCallback((sessionId: string): void => {
    processedAutoApproveRef.current.add(sessionId)
    window.electron.ipcRenderer.send('permission-timeout', sessionId)
  }, [])

  const handleCompletionClose = useCallback((sessionId: string): void => {
    setCompletionSessionIds((prev) => prev.filter((id) => id !== sessionId))
  }, [])

  const handleCompletionFocusTerminal = useCallback((sessionId: string): void => {
    window.electron.ipcRenderer.send('focus-terminal', sessionId)
    setCompletionSessionIds((prev) => prev.filter((id) => id !== sessionId))
  }, [])

  const dotColor = getSessionDotColor(sessions)
  const sessionCount = sessions.length
  const sortedSessions = sortSessions(sessions)

  const showPermissionCard =
    currentApproval !== null && !autoApproveRef.current.has(currentApproval.sessionId)

  // Current completion: first in queue that still exists in sessions
  const currentCompletionId = completionSessionIds[0] ?? null
  const currentCompletion = currentCompletionId
    ? (sessions.find((s) => s.sessionId === currentCompletionId) ?? null)
    : null

  const containerStyle: React.CSSProperties = {
    ...hudStyle,
    width: expanded ? `${EXPANDED_WIDTH}px` : `${COLLAPSED_WIDTH}px`,
    height: expanded ? `${EXPANDED_HEIGHT}px` : `${COLLAPSED_HEIGHT}px`
  }

  return (
    <div
      style={{ ...containerStyle, position: 'relative' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Settings panel overlay */}
      {showSettings && expanded && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}

      {/* Collapsed bar */}
      <div
        style={collapsedBarStyle}
        onClick={() => sessionCount > 0 && setExpanded((e) => !e)}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: dotColor,
            display: 'inline-block',
            flexShrink: 0
          }}
        />
        <span style={{ flex: 1, opacity: 0.9 }}>Claude Island</span>
        {sessionCount > 0 && (
          <span
            style={{
              fontSize: '11px',
              opacity: 0.6,
              background: 'rgba(255,255,255,0.1)',
              borderRadius: '10px',
              padding: '1px 6px'
            }}
          >
            {sessionCount}
          </span>
        )}
        {sessionCount > 0 && (
          <span style={{ fontSize: '10px', opacity: 0.5 }}>{expanded ? '▲' : '▼'}</span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (!expanded) {
              setExpanded(true)
            }
            setShowSettings((s) => !s)
          }}
          title="设置"
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.45)',
            cursor: 'pointer',
            fontSize: '13px',
            lineHeight: 1,
            padding: '2px 2px',
            flexShrink: 0
          }}
        >
          ⚙
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          {/* Permission confirmation card (shown first if present) */}
          {showPermissionCard && currentApproval && (
            <PermissionCard
              session={currentApproval}
              pendingCount={extraPendingCount}
              isHovered={isHovered}
              onAllow={handleAllow}
              onDeny={handleDeny}
              onAllowAll={handleAllowAll}
              onTimeout={handleTimeout}
            />
          )}

          {/* Task completion card (shown when no permission card, or below it) */}
          {currentCompletion && (
            <CompletionCard
              session={currentCompletion}
              isHovered={isHovered}
              onClose={handleCompletionClose}
              onFocusTerminal={handleCompletionFocusTerminal}
            />
          )}

          {/* Session list */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '4px 8px 12px'
            }}
          >
            {sortedSessions.length === 0 ? (
              <div style={{ opacity: 0.4, textAlign: 'center', marginTop: 16 }}>
                No active sessions
              </div>
            ) : (
              sortedSessions.map((s) => (
                <SessionRow key={s.sessionId} session={s} onClick={handleSessionClick} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
