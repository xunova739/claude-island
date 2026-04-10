//
//  AccessibilityWindowFocuser.swift
//  ClaudeIsland
//
//  Focuses specific terminal windows using CGWindowList + Accessibility API
//

import AppKit
import ApplicationServices

struct AccessibilityWindowFocuser {

    /// Focus the terminal window containing a Claude session.
    /// Returns true if a specific window was raised.
    static func focusTerminalWindow(terminalPid: Int, session: SessionState) -> Bool {
        // Only check silently - don't prompt here (prompting should be done at app startup if needed)
        guard AXIsProcessTrusted() else {
            return false
        }

        // Strategy 1: Find window by terminal PID via CGWindowList + AXUIElement
        if raiseWindowByPid(terminalPid) {
            return true
        }

        // Strategy 2: Title matching — find window whose title contains cwd or project name
        if raiseWindowByTitle(terminalPid: terminalPid, session: session) {
            return true
        }

        return false
    }

    // MARK: - Strategy 1: PID-based window raise

    private static func raiseWindowByPid(_ terminalPid: Int) -> Bool {
        let appElement = AXUIElementCreateApplication(pid_t(terminalPid))

        var windowsRef: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windowsRef)
        guard result == .success, let windows = windowsRef as? [AXUIElement] else {
            return false
        }

        // If only one window, raise it
        if windows.count == 1 {
            AXUIElementPerformAction(windows[0], kAXRaiseAction as CFString)
            activateApp(pid: terminalPid)
            return true
        }

        // Multiple windows — use CGWindowList to find which one matches our terminal PID
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let windowList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
            return false
        }

        let matchingCGWindows = windowList.filter {
            ($0[kCGWindowOwnerPID as String] as? Int) == terminalPid &&
            ($0[kCGWindowLayer as String] as? Int) == 0
        }

        if matchingCGWindows.count == 1, let first = windows.first {
            AXUIElementPerformAction(first, kAXRaiseAction as CFString)
            activateApp(pid: terminalPid)
            return true
        }

        return false
    }

    // MARK: - Strategy 2: Title-based window raise

    private static func raiseWindowByTitle(terminalPid: Int, session: SessionState) -> Bool {
        let appElement = AXUIElementCreateApplication(pid_t(terminalPid))

        var windowsRef: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windowsRef)
        guard result == .success, let windows = windowsRef as? [AXUIElement] else {
            return false
        }

        // Build search terms from session info
        let searchTerms = buildSearchTerms(session: session)

        // Try title matching first
        for window in windows {
            var titleRef: CFTypeRef?
            let titleResult = AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &titleRef)
            guard titleResult == .success, let title = titleRef as? String else { continue }

            let titleLower = title.lowercased()
            for term in searchTerms {
                if titleLower.contains(term.lowercased()) {
                    AXUIElementPerformAction(window, kAXRaiseAction as CFString)
                    activateApp(pid: terminalPid)
                    return true
                }
            }
        }

        // Title matching failed — if exactly 2 windows, raise the non-focused one.
        // The user is in the other window, so the Claude window is the other one.
        if windows.count == 2 {
            var focusedRef: CFTypeRef?
            AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &focusedRef)
            if let focusedRef = focusedRef {
                let focused = focusedRef as! AXUIElement
                if let target = windows.first(where: { !CFEqual($0, focused) }) {
                    AXUIElementPerformAction(target, kAXRaiseAction as CFString)
                    activateApp(pid: terminalPid)
                    return true
                }
            }
        }

        return false
    }

    // MARK: - App Activation (works across fullscreen Spaces)

    /// Activate app using AppleScript — more reliable than NSRunningApplication.activate()
    /// for switching to apps in fullscreen mode on a different Space.
    static func activateApp(pid: Int) {
        guard let app = NSRunningApplication(processIdentifier: pid_t(pid)),
              let appName = app.localizedName else {
            // Fallback to NSRunningApplication if no name
            NSRunningApplication(processIdentifier: pid_t(pid))?.activate(options: .activateIgnoringOtherApps)
            return
        }

        // AppleScript activation reliably triggers Space switching for fullscreen apps
        let script = NSAppleScript(source: "tell application \"\(appName)\" to activate")
        var error: NSDictionary?
        script?.executeAndReturnError(&error)

        // Belt-and-suspenders: also call NSRunningApplication.activate
        if error != nil {
            app.activate(options: .activateIgnoringOtherApps)
        }
    }

    private static func buildSearchTerms(session: SessionState) -> [String] {
        var terms: [String] = []

        // Use the last path component of cwd (directory name)
        let cwdLastComponent = URL(fileURLWithPath: session.cwd).lastPathComponent
        if !cwdLastComponent.isEmpty && cwdLastComponent != "/" {
            terms.append(cwdLastComponent)
        }

        // Use project name if different
        if session.projectName != cwdLastComponent {
            terms.append(session.projectName)
        }

        // "claude" — many terminals show the running process name as window title
        terms.append("claude")

        // Use full cwd path
        if !session.cwd.isEmpty {
            terms.append(session.cwd)
        }

        return terms
    }
}
