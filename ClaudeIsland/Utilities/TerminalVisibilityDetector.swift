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
    /// Pass `cwd` for precise multi-window disambiguation via focused window title matching.
    ///
    /// Strategy: PID-ancestor alignment. We don't maintain a whitelist of
    /// "known terminal" bundle IDs — instead we check whether the frontmost
    /// app is an ancestor of the Claude process in the process tree. This
    /// covers any host: Terminal.app, Ghostty, iTerm2, VSCode / Cursor / Zed /
    /// Trae / Qcode, Obsidian (Terminal plugin), Raycast terminal extensions,
    /// and any future embedded-terminal environment — without requiring
    /// registry updates.
    static func isSessionFocused(sessionPid: Int, cwd: String? = nil) async -> Bool {
        guard let frontmostApp = NSWorkspace.shared.frontmostApplication else {
            return false
        }
        let frontmostPid = Int(frontmostApp.processIdentifier)

        let tree = ProcessTreeBuilder.shared.buildTree()

        // tmux: delegate to pane-level focus detection (handles the case where
        // the terminal is frontmost but the user is on a different pane).
        if ProcessTreeBuilder.shared.isInTmux(pid: sessionPid, tree: tree) {
            return await TmuxTargetFinder.shared.isSessionPaneActive(claudePid: sessionPid)
        }

        // Core check: is the frontmost app an ancestor of the Claude process?
        guard ProcessTreeBuilder.shared.isDescendant(
            targetPid: sessionPid,
            ofAncestor: frontmostPid,
            tree: tree
        ) else {
            return false
        }

        // Multi-window disambiguation: if we have cwd and AX access, check
        // whether the focused window's title matches this session's cwd.
        // A positive match is conclusive; a negative match is NOT — most
        // terminals don't embed cwd in the default title, so we can't
        // penalize a non-match.
        if let sessionCwd = cwd, AXIsProcessTrusted() {
            if isFocusedWindowForSession(terminalPid: frontmostPid, cwd: sessionCwd) {
                return true
            }
        }

        // Fallback: if the host app has multiple on-screen windows and we
        // couldn't confirm the match via title, conservatively treat as not
        // focused (user may be looking at a different window of the same app).
        // Single-window hosts — including embedded-terminal IDEs like Obsidian,
        // Trae, Qcode, Raycast — fall through to "focused".
        let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        if let windowList = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] {
            let windowCount = windowList.filter {
                ($0[kCGWindowOwnerPID as String] as? Int) == frontmostPid &&
                ($0[kCGWindowLayer as String] as? Int) == 0
            }.count
            if windowCount > 1 && cwd != nil {
                return false
            }
        }

        return true
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
