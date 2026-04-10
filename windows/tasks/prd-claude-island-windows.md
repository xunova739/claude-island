# PRD: Claude Island Windows 版本

## Introduction

Claude Island Windows 是 macOS 版 Claude Island 的独立 Windows 实现。macOS 版通过 Swift/SwiftUI 在 MacBook 刘海区显示 Claude Code 会话状态，Windows 版用 **Electron + TypeScript + React** 实现等价功能：顶部居中悬浮 HUD 窗口，平时收起为细条，有事件时展开显示会话状态和操作按钮。

Python Hook 脚本（`~/.claude/hooks/claude-island-state.py`）**完全复用，不做任何修改**。

---

## Goals

- Windows 用户无需借助任何 macOS 工具即可使用 Claude Island 功能
- 视觉体验与 macOS 版一致：顶部居中悬浮 HUD，有事件时展开
- 权限确认在 HUD 内完成，无需切换到终端
- 多会话排队处理，不丢失任何待确认请求
- 安装后开箱即用，自动写入 Hook 配置

---

## User Stories

### US-001: 项目脚手架与开发环境
**描述：** 作为开发者，我需要一个可运行的 Electron + TypeScript + React 项目基础，以便后续 story 可以在此之上迭代。

**Acceptance Criteria：**
- [ ] 项目根目录有 `package.json`，包含 `dev`、`build`、`typecheck` 脚本
- [ ] 主进程 (`src/main/`) 用 TypeScript，渲染进程 (`src/renderer/`) 用 React + TypeScript
- [ ] `npm run dev` 能启动 Electron 窗口（任意内容即可）
- [ ] `npm run typecheck` 通过，无类型错误
- [ ] 有 `.gitignore`，忽略 `node_modules`、`dist`

---

### US-002: Unix Socket 服务端（Hook 接收）
**描述：** 作为系统，我需要监听来自 Python Hook 脚本的 Unix Socket 事件，以便接收 Claude Code 的状态通知。

**Acceptance Criteria：**
- [ ] 主进程启动时在 `/tmp/claude-island.sock` 监听（Win10 1803+ 支持 AF_UNIX，Node.js `net` 模块）
- [ ] 能正确解析 JSON 事件：`session_id`、`status`、`event`、`pid`、`tty`、`tool`、`tool_input`、`tool_use_id`
- [ ] `PermissionRequest` 事件保持 socket 连接开放，等待响应
- [ ] 其他事件接收后立即关闭连接
- [ ] 事件通过 IPC 发送到渲染进程
- [ ] `npm run typecheck` 通过

---

### US-003: 会话状态管理
**描述：** 作为系统，我需要维护所有活跃 Claude Code 会话的状态，以便 UI 能正确展示每个会话的当前阶段。

**Acceptance Criteria：**
- [ ] 定义 `SessionState` 类型：`sessionId`、`cwd`、`phase`（processing/waitingForApproval/waitingForInput/idle/ended）、`pid`、`pendingTool`（工具名 + 参数）、`lastMessage`
- [ ] 根据 Hook 事件正确转换 phase：
  - `UserPromptSubmit` → processing
  - `PreToolUse` → processing
  - `PermissionRequest` → waitingForApproval
  - `PostToolUse` → processing（同时清除 waitingForApproval，兼容终端手动同意）
  - `Stop` → waitingForInput
  - `SubagentStop` → processing（子代理完成，主代理仍在运行）
  - `SessionEnd` → ended
- [ ] 多个并发会话独立维护状态
- [ ] `npm run typecheck` 通过

---

### US-004: 顶部居中悬浮 HUD 窗口
**描述：** 作为用户，我需要一个始终在顶部的透明悬浮窗口，以便不打扰工作的同时能看到 Claude Code 状态。

**Acceptance Criteria：**
- [ ] `BrowserWindow` 配置：`frame: false`，`transparent: true`，`alwaysOnTop: true`，`skipTaskbar: true`，`resizable: false`
- [ ] 窗口位置：屏幕顶部水平居中，紧贴顶部边缘
- [ ] 收起态：高度 32px，宽度 200px，显示状态指示（处理中/需确认/空闲）
- [ ] 展开态：高度自适应（最大 320px），宽度 480px
- [ ] 无会话时隐藏窗口（`win.hide()`），有活跃会话时显示
- [ ] 使用 Fluent Design 风格：深色背景 `rgba(15,15,15,0.92)`，圆角 16px，毛玻璃感
- [ ] `npm run typecheck` 通过

---

### US-005: 会话列表视图（收起态展开内容）
**描述：** 作为用户，我想在 HUD 展开时看到所有活跃会话的列表，以便了解每个 Claude Code 的当前状态。

**Acceptance Criteria：**
- [ ] 展示每个会话：项目名（cwd 最后路径）、状态指示图标、最后消息摘要（单行）
- [ ] 状态颜色：processing = 橙色旋转图标，waitingForApproval = 黄色感叹号，waitingForInput = 绿色勾，idle = 灰点
- [ ] 点击会话行 → 跳转到对应终端窗口（US-009 实现）
- [ ] 会话按 needsAttention 优先排序（waitingForApproval > waitingForInput > processing > idle）
- [ ] `npm run typecheck` 通过

---

### US-006: 权限确认通知卡片
**描述：** 作为用户，当 Claude Code 需要执行需要确认的工具时，我希望看到详情卡片，以便在 HUD 内直接确认而不用切换到终端。

**Acceptance Criteria：**
- [ ] 有新 `waitingForApproval` 会话时，HUD 自动展开并显示通知卡片
- [ ] 卡片显示：会话标题、工具名（amber 色 monospace）、工具参数预览（最多 3 个参数，每个最多 120 字符）
- [ ] 10 秒倒计时，超时后卡片收回，Claude Code 回退到终端确认
- [ ] 鼠标 hover 在 HUD 上取消倒计时
- [ ] 三个操作按钮：**Deny**（白色）、**Allow**（白色背景黑字）、**全部允许**（黄色背景黑字）
- [ ] 点击 Deny → 发送 `{ decision: "deny" }` 到 socket
- [ ] 点击 Allow → 发送 `{ decision: "allow" }` 到 socket
- [ ] 点击全部允许 → Allow 当前 + 后续该会话所有 permission 自动 allow
- [ ] 多会话排队：处理完一个自动显示下一个，标题显示"还有 N 个待处理"
- [ ] `npm run typecheck` 通过

---

### US-007: 任务完成通知卡片
**描述：** 作为用户，当 Claude Code 完成任务时，我希望看到完成通知，以便知道何时可以查看结果。

**Acceptance Criteria：**
- [ ] `waitingForInput` 事件触发时（且该会话未处于前台）弹出完成卡片
- [ ] 卡片显示：绿色勾、"任务完成"标题、最后一条 Claude 消息（最多 4 行）
- [ ] 两个按钮：**关闭**、**跳转终端**（白色背景黑字）
- [ ] 10 秒倒计时自动关闭（鼠标 hover 取消）
- [ ] 播放系统提示音（Windows `mmsystem` 或 Electron `shell` 音效）
- [ ] `npm run typecheck` 通过

---

### US-008: 系统托盘图标
**描述：** 作为用户，我希望在任务栏托盘看到 Claude Island 状态图标，以便在 HUD 不显示时也能感知状态。

**Acceptance Criteria：**
- [ ] 托盘图标：空闲 = 灰色螃蟹，处理中 = 橙色，需确认 = 黄色感叹号
- [ ] 右键菜单：显示/隐藏 HUD、退出
- [ ] 左键点击 → 显示/切换 HUD
- [ ] 应用关闭时托盘图标随之消失
- [ ] `npm run typecheck` 通过

---

### US-009: 终端窗口跳转
**描述：** 作为用户，当我点击会话行或通知卡片的"跳转终端"时，我希望焦点切换到对应的终端窗口，以便快速查看 Claude 输出。

**Acceptance Criteria：**
- [ ] 通过 `session.pid` 找到对应的终端进程（Windows Terminal、Ghostty、VSCode、PowerShell）
- [ ] 使用 `EnumWindows` + `GetWindowThreadProcessId` 找到该进程的顶级窗口
- [ ] 调用 `SetForegroundWindow` 将其置前
- [ ] 全屏/最小化状态也能正确还原并激活（`ShowWindow(SW_RESTORE)`）
- [ ] 找不到窗口时静默失败（不报错）
- [ ] 通过 Node.js `ffi-napi` 或 `node-windows` 调用 Win32 API
- [ ] `npm run typecheck` 通过

---

### US-010: Hook 安装器
**描述：** 作为用户，我希望应用首次启动时自动配置 Claude Code Hook，以便不需要手动编辑配置文件。

**Acceptance Criteria：**
- [ ] 检查 `~/.claude/settings.json` 是否已有 Hook 配置
- [ ] 未配置时自动写入（参考 macOS 版 HookInstaller 的配置格式）
- [ ] Hook 脚本路径正确写入（`~/.claude/hooks/claude-island-state.py`）
- [ ] Python Hook 脚本若不存在则自动复制到 `~/.claude/hooks/`
- [ ] 设置面板中显示 Hook 状态（已安装/未安装），可手动切换
- [ ] `npm run typecheck` 通过

---

### US-011: 5 秒鼠标离开自动收回
**描述：** 作为用户，我希望鼠标离开 HUD 后 5 秒自动收回，以便不遮挡屏幕内容。

**Acceptance Criteria：**
- [ ] HUD 展开时，鼠标移出 HUD 区域 → 5 秒后自动收起
- [ ] 鼠标移回 HUD → 取消倒计时
- [ ] Chat 窗口打开时不自动收起
- [ ] `npm run typecheck` 通过

---

### US-012: 开机自启与设置面板
**描述：** 作为用户，我希望能配置 Claude Island 开机自启，并调整通知声音等偏好。

**Acceptance Criteria：**
- [ ] 设置面板（右上角菜单图标）：开机自启开关、通知声音选择（无声/默认/Pop）、Hook 状态
- [ ] 开机自启：写入注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
- [ ] 设置持久化到 `userData/settings.json`
- [ ] `npm run typecheck` 通过

---

### US-013: 应用内自动更新
**描述：** 作为用户，我希望在设置面板点击"检查更新"后自动下载安装最新版本，以便获取新功能和修复。

**Acceptance Criteria：**
- [ ] 调用 GitHub API `https://api.github.com/repos/xunova739/claude-island-windows/releases/tags/latest-build` 获取最新版本
- [ ] 检测到新版本时显示"Download Update"按钮，显示版本号
- [ ] 下载 `.exe` 安装包，显示进度条（0-100%）
- [ ] 下载完成后显示"Install & Relaunch"按钮
- [ ] 点击后静默安装（`/S` 参数）并重启应用
- [ ] 状态流转：idle → checking → found → downloading → readyToInstall → installing
- [ ] `npm run typecheck` 通过

---

### US-014: GitHub Actions 构建与 Release
**描述：** 作为开发者，我需要自动化构建流水线，以便每次推送 main 分支后自动生成 Windows 安装包并发布。

**Acceptance Criteria：**
- [ ] `.github/workflows/build.yml` 在 windows-latest runner 上运行
- [ ] 执行 `npm install` + `npm run build` 生成 `.exe` 安装包（NSIS installer）
- [ ] 构建成功后自动创建/更新 `latest-build` GitHub Release，附上 `.exe` 文件
- [ ] Release 包含 commit SHA 和构建时间戳
- [ ] 构建失败时 workflow 标记为失败

---

## Functional Requirements

- FR-1: 监听 `/tmp/claude-island.sock` Unix Socket，解析 Claude Code Hook 事件
- FR-2: 维护多会话状态机（processing/waitingForApproval/waitingForInput/idle/ended）
- FR-3: `PostToolUse` 到达时强制清除 `waitingForApproval`（兼容终端手动同意）
- FR-4: `SubagentStop` 映射为 processing（不触发完成通知）
- FR-5: 顶部居中透明悬浮窗，`alwaysOnTop`，`skipTaskbar`
- FR-6: 新 waitingForApproval 时自动展开 HUD 并显示确认卡片（10s 超时）
- FR-7: waitingForInput 时（非前台会话）展开 HUD 显示完成卡片（10s 超时）
- FR-8: 多会话确认排队，处理完一个自动切换下一个
- FR-9: 全部允许模式：会话进入自动允许后不再弹卡片
- FR-10: 系统托盘图标实时反映状态
- FR-11: 点击会话/跳转按钮用 Win32 API 置前对应终端窗口
- FR-12: 首次启动自动安装 Hook 配置
- FR-13: 鼠标离开 HUD 5 秒后自动收起

---

## Non-Goals

- 不实现 Chat 历史查看（JSONL 解析），仅显示最后一条消息
- 不支持 tmux pane 精准跳转（仅应用窗口级别）
- 不支持 macOS（macOS 版保持 Swift 版本不变）
- 不实现通知中心集成（仅 HUD 内通知）
- 不实现多显示器智能选择（始终用主显示器）

---

## Technical Considerations

- **Electron 版本**：≥ 28，使用 `contextIsolation: true`，`nodeIntegration: false`
- **IPC 通信**：主进程通过 `contextBridge` 暴露 API，渲染进程通过 `ipcRenderer`
- **Unix Socket**：Node.js `net.createServer()` 监听 `/tmp/claude-island.sock`（Win10 1803+ 支持 AF_UNIX）
- **Win32 API**：通过 `ffi-napi` 或 `edge-js` 调用 `user32.dll` 的 `SetForegroundWindow`、`EnumWindows`
- **打包**：`electron-builder`，目标格式 NSIS installer（`.exe`）
- **Python Hook 脚本**：直接复用 macOS 版，不做修改

---

## Success Metrics

- Windows 用户安装后无需任何手动配置即可使用
- 权限确认在 2 次点击内完成（无需切换到终端）
- HUD 内存占用 < 100MB

---

## Open Questions

- Windows 上 `/tmp/claude-island.sock` 路径是否统一？Claude Code for Windows 的默认路径可能不同，需验证。
- 终端窗口标题格式（Windows Terminal / Ghostty for Windows）是否包含工作目录，影响窗口匹配准确率。
