<div align="center">
  <img src="ClaudeIsland/Assets.xcassets/AppIcon.appiconset/icon_128x128.png" alt="Logo" width="100" height="100">
  <h3 align="center">Claude Island</h3>
  <p align="center">
    在 MacBook 刘海区显示 Claude Code 会话状态 · Dynamic Island for Claude Code CLI
    <br />
    <br />
    <a href="https://github.com/xunova739/claude-island/releases/tag/latest-build">
      <img src="https://img.shields.io/badge/download-latest_build-white?style=flat&labelColor=000000" alt="Download" />
    </a>
    <a href="https://github.com/farouqaldori/claude-island">
      <img src="https://img.shields.io/badge/fork_of-farouqaldori%2Fclaude--island-555?style=flat&labelColor=000000" alt="Fork of" />
    </a>
  </p>
</div>

> **中文增强版** — Fork 自 [farouqaldori/claude-island](https://github.com/farouqaldori/claude-island)，新增通知详情卡片、全部允许、单击跳转终端、应用内自动更新等功能。

---

## 安装

### 直接下载（推荐）

1. 前往 [Releases](https://github.com/xunova739/claude-island/releases/tag/latest-build) 下载 `ClaudeIsland-focused-notch.dmg`
2. 打开 DMG → 将 `Claude Island.app` 拖入 `/Applications/`
3. 打开应用

### 应用内更新

已安装后：刘海区 → 右上角菜单 → **Check for Updates** → 自动下载安装最新版

---

## 使用方法

### 首次配置

1. 打开 Claude Island，系统会弹出**辅助功能**授权（用于点击跳转终端）
2. 前往 系统设置 → 隐私与安全性 → 辅助功能 → 启用 Claude Island
3. 在终端运行 `claude`，刘海区自动显示会话状态

### 交互说明

| 操作 | 效果 |
|------|------|
| 单击 session 行 | 跳转到对应终端窗口 |
| 双击 session 行 | 打开 Chat 查看完整对话历史 |
| Allow | 批准当前工具操作 |
| Deny | 拒绝当前工具操作 |
| 全部允许 | 批准本次对话所有后续操作（不再弹窗） |
| 跳转终端 | 任务完成后 focus 到终端 |
| Hover 弹窗 | 取消 10 秒自动收回 |

### 权限确认流程

当 Claude 需要执行工具（写文件、运行命令等）时：

```
Claude Code 触发工具 → 刘海弹出详情卡片（工具名 + 参数预览）
    ↓ 点 Allow/Deny → 继续执行
    ↓ 10 秒无响应 → 自动回退到终端确认
    ↓ 点 全部允许 → 本次对话后续操作全部自动批准
```

### 菜单设置

| 选项 | 说明 |
|------|------|
| Screen | 选择显示刘海的显示器 |
| Notification Sound | 任务完成提示音 |
| Launch at Login | 开机自启 |
| Hooks | 安装/卸载 Claude Code Hook |
| Accessibility | 辅助功能权限状态 |
| Check for Updates | 检查并安装最新版 |

---

## Features

- **Notch UI** — Animated overlay that expands from the MacBook notch
- **Live Session Monitoring** — Track multiple Claude Code sessions in real-time
- **Permission Approvals** — Approve or deny tool executions directly from the notch
- **Chat History** — View full conversation history with markdown rendering
- **Auto-Setup** — Hooks install automatically on first launch

## Requirements

- macOS 15.6+
- Claude Code CLI

## Install

Download the latest release or build from source:

```bash
xcodebuild -scheme ClaudeIsland -configuration Release build
```

## How It Works

Claude Island installs hooks into `~/.claude/hooks/` that communicate session state via a Unix socket. The app listens for events and displays them in the notch overlay.

When Claude needs permission to run a tool, the notch expands with approve/deny buttons—no need to switch to the terminal.

## Analytics

Claude Island uses Mixpanel to collect anonymous usage data:

- **App Launched** — App version, build number, macOS version
- **Session Started** — When a new Claude Code session is detected

No personal data or conversation content is collected.

## License

Apache 2.0
