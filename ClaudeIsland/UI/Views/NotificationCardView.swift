//
//  NotificationCardView.swift
//  ClaudeIsland
//
//  Focused notification card shown when a session needs attention
//

import SwiftUI

struct NotificationCardView: View {
    let session: SessionState
    let countdown: Int
    let onApprove: () -> Void
    let onDeny: () -> Void
    let onApproveAll: () -> Void
    let onChat: () -> Void
    let onFocus: () -> Void
    let onDismiss: () -> Void

    private let claudeOrange = Color(red: 0.85, green: 0.47, blue: 0.34)

    private var isWaitingForApproval: Bool {
        session.phase.isWaitingForApproval
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Title row
            HStack {
                Text(session.displayTitle)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(1)

                Spacer()

                if countdown > 0 {
                    Text("\(countdown)s")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(.white.opacity(0.3))
                }
            }

            // Tool details
            if isWaitingForApproval {
                approvalContent
            } else {
                completionContent
            }

            // Action buttons
            if isWaitingForApproval {
                approvalButtons
            } else {
                completionButtons
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Approval Content

    @ViewBuilder
    private var approvalContent: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let toolName = session.pendingToolName {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 11))
                        .foregroundColor(TerminalColors.amber)

                    Text(MCPToolFormatter.formatToolName(toolName))
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .foregroundColor(TerminalColors.amber)
                }
            }

            if let permission = session.activePermission,
               let input = permission.toolInput {
                toolInputPreview(input)
            }
        }
    }

    @ViewBuilder
    private func toolInputPreview(_ input: [String: AnyCodable]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(input.prefix(3)), id: \.key) { key, value in
                HStack(alignment: .top, spacing: 4) {
                    Text(key + ":")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(.white.opacity(0.5))
                        .frame(minWidth: 50, alignment: .trailing)

                    Text(formatValue(value))
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.white.opacity(0.7))
                        .lineLimit(2)
                }
            }
            if input.count > 3 {
                Text("... +\(input.count - 3) more")
                    .font(.system(size: 10))
                    .foregroundColor(.white.opacity(0.3))
            }
        }
        .padding(8)
        .background(Color.white.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func formatValue(_ value: AnyCodable) -> String {
        switch value.value {
        case let str as String:
            return str.count > 120 ? String(str.prefix(120)) + "..." : str
        case let num as Int:
            return String(num)
        case let num as Double:
            return String(num)
        case let bool as Bool:
            return bool ? "true" : "false"
        default:
            return "..."
        }
    }

    // MARK: - Completion Content

    @ViewBuilder
    private var completionContent: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 14))
                    .foregroundColor(TerminalColors.green)

                Text("任务完成")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(TerminalColors.green)

                Spacer()
            }

            // Show last message from Claude if available
            if let lastMsg = session.lastMessage, !lastMsg.isEmpty {
                Text(lastMsg)
                    .font(.system(size: 12))
                    .foregroundColor(.white.opacity(0.7))
                    .lineLimit(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(10)
        .background(Color.white.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - Approval Buttons

    @ViewBuilder
    private var approvalButtons: some View {
        HStack(spacing: 8) {
            Button { onChat() } label: {
                Image(systemName: "bubble.left")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.white.opacity(0.5))
                    .frame(width: 28, height: 28)
                    .background(Color.white.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(.plain)

            Spacer()

            Button { onDeny() } label: {
                Text("Deny")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.white.opacity(0.6))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(Color.white.opacity(0.1))
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)

            Button { onApprove() } label: {
                Text("Allow")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.black)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(Color.white.opacity(0.9))
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)

            Button { onApproveAll() } label: {
                Text("全部允许")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.black)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(Color(red: 1.0, green: 0.8, blue: 0.3))
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Completion Buttons

    @ViewBuilder
    private var completionButtons: some View {
        HStack(spacing: 8) {
            Spacer()

            Button { onDismiss() } label: {
                Text("关闭")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.white.opacity(0.5))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(Color.white.opacity(0.1))
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)

            Button { onFocus() } label: {
                HStack(spacing: 4) {
                    Image(systemName: "terminal")
                        .font(.system(size: 10, weight: .medium))
                    Text("跳转终端")
                        .font(.system(size: 12, weight: .medium))
                }
                .foregroundColor(.black)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background(Color.white.opacity(0.9))
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)
        }
    }
}
