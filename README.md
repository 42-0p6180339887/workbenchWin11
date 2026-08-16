# Workbench for Windows 🧰

> 不用打开配置文件，也能看懂并管理本机 Codex 的 Skills、Hooks、Memory、MCP、用量和存储。

[![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-0a0a0c?style=flat-square&logo=windows11)](https://github.com/42-0p6180339887/workbenchWin11/actions)
[![Windows build](https://img.shields.io/github/actions/workflow/status/42-0p6180339887/workbenchWin11/windows-release.yml?branch=main&style=flat-square&label=Windows%20build)](https://github.com/42-0p6180339887/workbenchWin11/actions/workflows/windows-release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-56b7e9?style=flat-square)](LICENSE)

Workbench for Windows 是对 [fslot2601-source/workbench](https://github.com/fslot2601-source/workbench) 的 Windows 重构。界面和系统集成改为 Electron、React 与 TypeScript，核心仍通过 Codex App Server 获取真实状态，不解析日志来猜测结果。

应用随安装包附带固定版本的 OpenAI 官方 Codex CLI。它使用当前 Windows 用户原有的 `~/.codex` 配置和登录状态，不需要单独安装 CLI，也不会复制或上传登录令牌。

## 功能

- **总览**：连接状态、工作区、限额、Token 汇总、能力健康度和本机占用。
- **Skills**：用途、来源、依赖与错误，以及自动可用、仅显式调用、隐藏三种模式。
- **Hooks**：触发时机、匹配范围、处理器、信任状态和安全启停。
- **Memory**：只读查看记忆摘要与来源；敏感行自动隐藏，raw/Chronicle 默认不展示。
- **账户用量**：直接显示 Codex 官方接口返回的限额、重置时间和使用趋势。
- **MCP**：区分“写入配置”“已启用”“能力已读取”，展示工具与资源并安全启停。
- **本机存储**：分类统计 Codex Home；只对白名单缓存、过期临时文件和日志提供回收站清理。
- **GitHub 备份**：通过本机 GitHub CLI 将脱敏后的白名单配置备份到私人仓库。
- **变更记录与系统自检**：保留本机操作历史，并明确显示无法验证的状态。
- **Windows 集成**：原生标题栏按钮、系统深浅色、托盘菜单、安装包和便携版。
- **软件内更新**：安装版可在“设置 → 软件更新”检查、下载并退出安装来自本仓库 GitHub Releases 的正式版本。

## 安装

### 系统要求

- Windows 10 22H2 或 Windows 11（x64）
- 已使用 Codex 或 ChatGPT 登录过；Workbench 会复用当前 Windows 用户的 Codex 状态

在仓库的 [Actions](https://github.com/42-0p6180339887/workbenchWin11/actions/workflows/windows-release.yml) 或 Releases 页面下载：

- `Workbench-Windows-Setup-2.2.0-x64.exe`：图形化安装程序，支持后续软件内升级
- `Workbench-Windows-Portable-2.2.0-x64.exe`：无需安装的便携版；更新时从 Releases 手动下载

当前社区构建没有商业代码签名证书，Windows SmartScreen 可能显示“未知发布者”。请只从本仓库下载，并核对旁边的 SHA-256 文件。

2.1.0 及更早版本没有内置更新器，需要手动安装一次 2.2.0。以后安装版可在软件内完成“检查更新 → 下载 → 退出并安装”。更新通道只读取本仓库公开的正式 Release；草稿和预发布版本不会推送给稳定版用户。

首次启动默认使用当前 Windows 用户目录作为工作区；点击左下角的工作区卡片即可选择实际项目目录。

## 隐私与安全边界

- 没有遥测、广告或独立账户系统。
- Workbench 不读取、显示或保存 Codex 登录令牌。
- 主窗口启用 Electron 上下文隔离、渲染器沙箱和严格 IPC 白名单。
- 配置写入只允许 Codex 返回的个人层，并使用版本号避免覆盖并发修改。
- Memory 限制文件类型、数量和大小；预览会隐藏疑似密钥、密码、令牌和授权头。
- 存储清理要求扫描指纹匹配，拒绝符号链接和越界路径，处理内容进入 Windows 回收站。
- GitHub 备份只接受 `owner/name` 格式的私人仓库，并再次对文本脱敏。
- 未知、系统或管理员托管内容保持只读；“已配置”不会被显示成“已经运行”。

详细设计见 [Windows 架构与安全边界](docs/WINDOWS_ARCHITECTURE.md)。

## 从源码构建

需要 Node.js 22 和 npm 10+：

```powershell
npm install
npm run typecheck
npm test
npm run dist:win
```

输出位于 `release/windows/`。日常开发使用：

```powershell
npm run dev
```

真实 Codex App Server 协议探针：

```powershell
npm run build
node scripts/probe-codex.cjs
```

## 项目结构

```text
src/main/       Electron 主进程、Codex 协议和本机安全服务
src/preload/    最小化 IPC 桥
src/renderer/   React 可视化界面
src/shared/     主进程与界面共享的数据契约
tests/          安全边界与本机数据测试
SkillLens/      上游 macOS SwiftUI 实现（保留作行为参照）
```

## 版本关系

Windows 2.2.0 以原 macOS 1.3.0 的信息架构、安全原则和视觉系统为基线重新实现。Windows 与 macOS 构建不会共享设置文件或自动更新通道；两者都会读取当前用户的 Codex Home。

## License

MIT。Workbench 是独立开源项目，与 OpenAI 无隶属或官方授权关系。感谢原作者 [fslot2601-source](https://github.com/fslot2601-source) 的设计与实现。
