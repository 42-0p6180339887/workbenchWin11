# Windows 架构与安全边界

## 目标

Windows 版本不是 SwiftUI 界面的逐像素翻译，而是保留上游 Workbench 的状态语义和安全原则，在 Windows 桌面运行模型下重新实现。所有 Codex 能力状态优先来自官方 App Server；本机文件扫描只用于 Memory、存储分类和明确的备份白名单。

## 进程边界

```text
React renderer (sandboxed)
        │ typed IPC allowlist
        ▼
Electron main process
        ├── Codex App Server (stdio JSON-RPC)
        ├── read-only Memory / storage scanners
        ├── guarded configuration mutations
        └── Windows recycle bin / optional GitHub CLI
```

渲染器没有 Node.js 权限，不能任意访问文件或执行命令。所有操作都经过 preload 中声明的窄接口；主进程再次验证类型、长度、协议、路径和当前扫描指纹。

## Codex 运行时

Microsoft Store 应用内部的 `codex.exe` 位于受保护的 MSIX 目录，外部桌面程序可能得到 `EPERM`。因此 Windows 包随附 npm 包 `@openai/codex` 提供的 x64 原生运行时，并保持其 `bin`、`codex-path` 和 `codex-resources` 相对布局。

启动顺序为：

1. 用户在设置中明确选择且能通过 `--version` 探针的官方 CLI；
2. Workbench 随包附带的 CLI；
3. `CODEX_BINARY` 与 `PATH` 中可通过探针的 CLI；
4. 常见独立安装位置。

Workbench 通过 `codex app-server --stdio` 建立 JSON-RPC 连接，发送 `initialize` / `initialized`，再按页面调用 Skills、Hooks、Config、Usage 和 MCP 接口。随包 CLI 不建立第二套用户目录；正常桌面运行时仍使用当前 Windows 账户的 Codex Home。

## 写入策略

- Skill：只允许用户或仓库范围；启停交给 App Server，调用策略只改相邻的受限 metadata 文件。
- Hook / MCP：只允许个人配置层，要求 App Server 返回可写层版本，写后重新读取验证。
- Memory：始终只读。
- 存储：固定组件白名单、拒绝符号链接、扫描指纹复核、同卷暂存、失败回滚、Windows 回收站。
- 备份：只收集明确文件，限制单文件与总大小，整行隐藏敏感配置，只允许已初始化的私人仓库。

## 打包与验证

`electron-builder` 生成 x64 NSIS 安装包和 portable 可执行文件。CI 执行 TypeScript 类型检查、Vitest、安全协议探针与 Windows 打包，并为每个 `.exe` 生成 SHA-256。当前社区版本未签名；若用于组织分发，应在 CI 中增加受保护的代码签名证书和签名验证门禁。
