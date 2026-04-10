import { execSync } from 'child_process'

function buildPsScript(pid: number): string {
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Helper {
    public delegate bool EnumWndProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWndProc lpEnum, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint procId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$targetPid = ${pid}
$targetHwnd = [IntPtr]::Zero
[Win32Helper]::EnumWindows([Win32Helper+EnumWndProc]{
    param($hWnd, $lParam)
    $procId = 0
    [Win32Helper]::GetWindowThreadProcessId($hWnd, [ref]$procId) | Out-Null
    if ($procId -eq $targetPid -and [Win32Helper]::IsWindowVisible($hWnd)) {
        $script:targetHwnd = $hWnd
        return $false
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
if ($targetHwnd -ne [IntPtr]::Zero) {
    if ([Win32Helper]::IsIconic($targetHwnd)) {
        [Win32Helper]::ShowWindow($targetHwnd, 9) | Out-Null
    }
    [Win32Helper]::SetForegroundWindow($targetHwnd) | Out-Null
}
`
}

export function focusTerminalByPid(pid: number): void {
  if (process.platform !== 'win32') return

  try {
    const script = buildPsScript(pid)
    // Encode as UTF-16LE for -EncodedCommand to avoid all quoting issues
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    execSync(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
      timeout: 5000,
      stdio: 'ignore'
    })
  } catch {
    // Silent failure: window not found or PowerShell unavailable
  }
}
