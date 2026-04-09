//
//  TerminalVisibilityDetector.swift
//  ClaudeIsland
//
//  Detects if terminal windows are visible on current space
//

import AppKit
import ApplicationServices
import CoreGraphics

struct TerminalVisibilityDetector {
    /// Check if any terminal window is visible on the current space
    static func isTerminalVisibleOnCurrentSpace() -> Bool {
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]

        guard let windowList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
            return false
        }

        for window in windowList {
            guard let ownerName = window[kCGWindowOwnerName as String] as? String,
                  let layer = window[kCGWindowLayer as String] as? Int,
                  layer == 0 else { continue }

            if TerminalAppRegistry.isTerminal(ownerName) {
                return true
            }
        }

        return false
    }

    /// Check if the frontmost (active) application is a terminal
    static func isTerminalFrontmost() -> Bool {
        guard let frontmostApp = NSWorkspace.shared.frontmostApplication,
              let bundleId = frontmostApp.bundleIdentifier else {
            return false
        }

        return TerminalAppRegistry.isTerminalBundle(bundleId)
    }

    /// Check if a Claude session is currently focused (user is looking at it).
    /// Pass `cwd` for precise multi-window detection via focused window title matching.
    static func isSessionFocused(sessionPid: Int, cwd: String? = nil) async -> Bool {
        // If no terminal is frontmost, session is definitely not focused
        guard isTerminalFrontmost() else {
            return false
        }

        let tree = ProcessTreeBuilder.shared.buildTree()
        let isInTmux = ProcessTreeBuilder.shared.isInTmux(pid: sessionPid, tree: tree)

        if isInTmux {
            return await TmuxTargetFinder.shared.isSessionPaneActive(claudePid: sessionPid)
        } else {
            guard let sessionTerminalPid = ProcessTreeBuilder.shared.findTerminalPid(forProcess: sessionPid, tree: tree),
                  let frontmostApp = NSWorkspace.shared.frontmostApplication else {
                return false
            }

            // Terminal app must be frontmost
            guard sessionTerminalPid == Int(frontmostApp.processIdentifier) else {
                return false
            }

            // Primary check: use AXUIElement to get the focused window title and compare to session cwd.
            // This works correctly even when windows are on different Spaces.
            if let sessionCwd = cwd, AXIsProcessTrusted() {
                return isFocusedWindowForSession(terminalPid: sessionTerminalPid, cwd: sessionCwd)
            }

            // Fallback: if multiple on-screen windows, can't determine focus → show notification
            let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
            if let windowList = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] {
                let windowCount = windowList.filter {
                    ($0[kCGWindowOwnerPID as String] as? Int) == sessionTerminalPid &&
                    ($0[kCGWindowLayer as String] as? Int) == 0
                }.count
                if windowCount > 1 {
                    return false
                }
            }

            return true
        }
    }

    /// Uses AX focused window title to determine if the user is looking at this specific session's window.
    /// More accurate than CGWindowList for multi-window terminals across Spaces.
    private static func isFocusedWindowForSession(terminalPid: Int, cwd: String) -> Bool {
        let appElement = AXUIElementCreateApplication(pid_t(terminalPid))

        var focusedWindowRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &focusedWindowRef) == .success,
              let focusedWindow = focusedWindowRef else {
            return false
        }

        var titleRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(focusedWindow as! AXUIElement, kAXTitleAttribute as CFString, &titleRef) == .success,
              let title = titleRef as? String else {
            return false
        }

        let titleLower = title.lowercased()
        let cwdLastComponent = URL(fileURLWithPath: cwd).lastPathComponent.lowercased()

        // Match window title against session directory name
        if !cwdLastComponent.isEmpty && titleLower.contains(cwdLastComponent) {
            return true
        }

        // Also try the full cwd path
        if !cwd.isEmpty && titleLower.contains(cwd.lowercased()) {
            return true
        }

        // No match: user is in a different window
        return false
    }
}
