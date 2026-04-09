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
        // Prompt for accessibility permission on first call
        let options = [kAXTrustedCheckOptionPrompt.takeRetainedValue(): true] as CFDictionary
        guard AXIsProcessTrustedWithOptions(options) else {
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
            NSRunningApplication(processIdentifier: pid_t(terminalPid))?.activate(options: .activateIgnoringOtherApps)
            return true
        }

        // Multiple windows — use CGWindowList to find which one matches our terminal PID
        // For multi-process terminals (like Ghostty), each window may have a unique PID
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let windowList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
            return false
        }

        // Find CGWindow entries matching terminal PID
        let matchingCGWindows = windowList.filter {
            ($0[kCGWindowOwnerPID as String] as? Int) == terminalPid &&
            ($0[kCGWindowLayer as String] as? Int) == 0
        }

        // If exactly one on-screen window for this PID, raise the first AX window
        if matchingCGWindows.count == 1, let first = windows.first {
            AXUIElementPerformAction(first, kAXRaiseAction as CFString)
            NSRunningApplication(processIdentifier: pid_t(terminalPid))?.activate(options: .activateIgnoringOtherApps)
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
        guard !searchTerms.isEmpty else { return false }

        for window in windows {
            var titleRef: CFTypeRef?
            let titleResult = AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &titleRef)
            guard titleResult == .success, let title = titleRef as? String else { continue }

            let titleLower = title.lowercased()
            for term in searchTerms {
                if titleLower.contains(term.lowercased()) {
                    AXUIElementPerformAction(window, kAXRaiseAction as CFString)
                    NSRunningApplication(processIdentifier: pid_t(terminalPid))?.activate(options: .activateIgnoringOtherApps)
                    return true
                }
            }
        }

        return false
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

        // Use full cwd path
        if !session.cwd.isEmpty {
            terms.append(session.cwd)
        }

        return terms
    }
}
