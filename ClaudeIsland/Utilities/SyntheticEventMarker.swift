//
//  SyntheticEventMarker.swift
//  ClaudeIsland
//
//  Tags CGEvents that we synthesize ourselves so that our own global
//  mouse monitor can recognize and ignore them. Without this filter,
//  reposting a click (to pass it through to the window behind us) gets
//  captured by `addGlobalMonitorForEvents(matching: .leftMouseDown)` and
//  fed back into `handleMouseDown`, which then re-opens the notch.
//

import AppKit

enum SyntheticEventMarker {
    /// User-data value embedded in CGEventSource. "CLAI" interpreted as hex.
    static let userData: Int64 = 0x434C_4149

    /// Returns a CGEventSource tagged with our marker, or nil if creation fails.
    /// Callers should still post events with a `nil` source on failure — the
    /// repost will then behave like pre-fix code (self-triggering) rather than
    /// failing outright.
    static func markedSource() -> CGEventSource? {
        guard let source = CGEventSource(stateID: .privateState) else { return nil }
        source.userData = userData
        return source
    }

    /// True if the NSEvent was produced by one of our synthesized CGEvents.
    static func isSynthetic(_ event: NSEvent) -> Bool {
        guard let cgEvent = event.cgEvent else { return false }
        return cgEvent.getIntegerValueField(.eventSourceUserData) == userData
    }
}
