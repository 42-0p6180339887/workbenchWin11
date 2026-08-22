import { app, type WebContents } from "electron";
import { lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ActionResult,
  BackupPreview,
  DiagnosticRecord,
  HookRecord,
  SectionName,
  SkillMode,
  SkillRecord,
  StorageKind,
  WorkbenchSettings,
  WorkbenchSnapshot,
} from "../shared/types";
import { sanitize } from "./security";
import { SettingsStore } from "./settings-store";
import { BackupService } from "./services/backup-service";
import { locateCodex, validateCodexSelection } from "./services/codex-locator";
import { CodexService } from "./services/codex-service";
import { scanMemory } from "./services/memory-service";
import { StorageService } from "./services/storage-service";

const emptyMemory = { records: [], visibleRecords: [], warnings: [] as string[], totalBytes: 0 };

export class WorkbenchController {
  private readonly store = new SettingsStore();
  private readonly codex = new CodexService();
  private readonly backup = new BackupService();
  private readonly storage: StorageService;
  private webContents?: WebContents;
  private initialized = false;
  private connecting?: Promise<void>;
  private state!: WorkbenchSnapshot;
  private skillError?: string;
  private hookError?: string;
  private memoryError?: string;
  private storageError?: string;
  private backupError?: string;

  constructor(trashItem: (target: string) => Promise<void>) {
    this.storage = new StorageService(trashItem);
    this.codex.appServer.on("exit", (error: Error) => {
      if (!this.initialized) return;
      this.state.connection = { status: "failed", label: "连接已断开", error: sanitize(error.message) };
      this.updateDiagnostics();
      this.emit();
    });
  }

  get snapshot(): WorkbenchSnapshot {
    return structuredClone(this.state);
  }

  async shutdown(): Promise<void> {
    await this.codex.disconnect();
  }

  attach(webContents: WebContents): void {
    this.webContents = webContents;
  }

  async bootstrap(): Promise<WorkbenchSnapshot> {
    await this.ensureInitialized();
    await this.refreshAll(false);
    return structuredClone(this.state);
  }

  async refresh(section?: SectionName, forceReload = false): Promise<WorkbenchSnapshot> {
    await this.ensureInitialized();
    if (!section || section === "dashboard" || section === "diagnostics") {
      await this.refreshAll(forceReload);
      return structuredClone(this.state);
    }
    if (["skills", "hooks", "usage", "mcp"].includes(section)) await this.ensureConnection();
    switch (section) {
      case "skills": await this.refreshSkills(forceReload); break;
      case "hooks": await this.refreshHooks(); break;
      case "usage": await this.refreshUsage(); break;
      case "mcp": await this.refreshMCP(); break;
      case "memory": await this.refreshMemory(); break;
      case "storage": await this.refreshStorage(); break;
      case "backup": await this.refreshBackup(); break;
      case "history": this.state.history = this.store.history; break;
      case "settings": break;
    }
    this.finishRefresh();
    return structuredClone(this.state);
  }

  async setWorkspace(workspacePath: string): Promise<WorkbenchSnapshot> {
    await this.ensureInitialized();
    const stat = await lstat(workspacePath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("工作区必须是可读取的普通目录。");
    this.state.workspacePath = path.resolve(workspacePath);
    await this.store.updateSettings({ workspacePath: this.state.workspacePath });
    this.state.settings = this.store.settings;
    await this.refreshAll(true);
    return structuredClone(this.state);
  }

  async setCodexExecutable(executablePath: string): Promise<WorkbenchSnapshot> {
    await this.ensureInitialized();
    const resolved = await validateCodexSelection(executablePath);
    await this.store.updateSettings({ preferredCodexPath: resolved });
    this.state.settings = this.store.settings;
    await this.codex.disconnect();
    this.state.codexExecutable = resolved;
    await this.refreshAll(true);
    return structuredClone(this.state);
  }

  async setSkillMode(skillId: string, mode: SkillMode): Promise<ActionResult> {
    await this.ensureConnection();
    const skill = this.state.skills.find((item) => item.id === skillId);
    if (!skill) throw new Error("Skill 已不在当前清单中，请重新扫描。");
    if (!(["implicit", "explicit", "hidden"] as SkillMode[]).includes(mode)) throw new Error("不支持的 Skill 模式。");
    await this.codex.setSkillMode(skill, mode, this.state.workspacePath, this.state.codexHome);
    await this.store.addHistory({ category: "skill", title: `调整 ${skill.displayName}`, detail: `调用方式改为${modeTitle(mode)}。`, reversible: true });
    await this.refreshSkills(true);
    return this.action(`已将 ${skill.displayName} 设为${modeTitle(mode)}。`);
  }

  async setHookEnabled(hookId: string, enabled: boolean): Promise<ActionResult> {
    await this.ensureConnection();
    const hook = this.state.hooks.find((item) => item.id === hookId);
    if (!hook) throw new Error("Hook 已不在当前清单中，请重新扫描。");
    await this.codex.setHookEnabled(hook, enabled, this.state.workspacePath);
    await this.store.addHistory({ category: "hook", title: `${enabled ? "启用" : "停用"} ${hook.displayName}`, detail: hook.eventTitle, reversible: true });
    await this.refreshHooks();
    return this.action(`${hook.displayName} 已${enabled ? "启用" : "停用"}。`);
  }

  async setMCPEnabled(name: string, enabled: boolean): Promise<ActionResult> {
    await this.ensureConnection();
    const server = this.state.mcpServers.find((item) => item.name === name);
    if (!server) throw new Error("MCP 已不在当前清单中，请重新扫描。");
    await this.codex.setMCPEnabled(name, enabled, this.state.workspacePath);
    await this.store.addHistory({ category: "mcp", title: `${enabled ? "启用" : "停用"} ${server.displayName}`, detail: "配置已写入；重新载入前运行状态可能保持不变。", reversible: true });
    await this.refreshMCP();
    return this.action(`${server.displayName} 配置已${enabled ? "启用" : "停用"}。`);
  }

  async reloadMCP(): Promise<ActionResult> {
    await this.ensureConnection();
    await this.codex.reloadMCP();
    await this.refreshMCP();
    return this.action("所有 MCP 已重新载入。");
  }

  async cleanupStorage(kind: StorageKind, fingerprint: string): Promise<ActionResult> {
    if (!fingerprint || fingerprint.length > 128) throw new Error("清理校验信息无效，请重新扫描。");
    const result = await this.storage.cleanup(this.state.codexHome, kind, fingerprint);
    const record = this.state.storage.find((item) => item.kind === kind);
    await this.store.addHistory({ category: "storage", title: `清理${record?.title ?? kind}`, detail: `${formatBytes(result.bytes)}，${result.items} 个文件，${result.disposition}。`, reversible: true });
    await this.refreshStorage();
    return this.action(`已处理 ${formatBytes(result.bytes)}，${result.disposition}。`);
  }

  async saveSettings(patchValue: Partial<WorkbenchSettings>): Promise<ActionResult> {
    const patch: Partial<WorkbenchSettings> = {};
    if (patchValue.theme && ["system", "light", "dark"].includes(patchValue.theme)) patch.theme = patchValue.theme;
    if (typeof patchValue.showTrayIcon === "boolean") patch.showTrayIcon = patchValue.showTrayIcon;
    if (typeof patchValue.autoRefreshMinutes === "number") patch.autoRefreshMinutes = Math.max(1, Math.min(60, Math.round(patchValue.autoRefreshMinutes)));
    if (patchValue.backupRepository !== undefined) {
      if (patchValue.backupRepository.length > 200) throw new Error("仓库名称过长。");
      patch.backupRepository = patchValue.backupRepository.trim();
    }
    await this.store.updateSettings(patch);
    await this.store.addHistory({ category: "settings", title: "更新 Workbench 设置", detail: "本地偏好已保存。", reversible: true });
    this.state.settings = this.store.settings;
    this.state.history = this.store.history;
    this.finishRefresh();
    return this.action("设置已保存。");
  }

  async previewBackup(repository: string): Promise<BackupPreview> {
    return this.backup.preview(this.state.codexHome, repository);
  }

  async runBackup(repository: string): Promise<ActionResult> {
    const result = await this.backup.run(this.state.codexHome, repository);
    await this.store.updateSettings({ backupRepository: repository });
    await this.store.markBackup();
    await this.store.addHistory({ category: "backup", title: "上传 Codex 配置备份", detail: `${result.files} 个文件，提交 ${result.commit}，目标 ${repository}。`, reversible: true });
    await this.refreshBackup();
    this.state.settings = this.store.settings;
    return this.action(result.commit === "没有变化" ? "配置与远端备份一致，没有创建新提交。" : `备份已上传，提交 ${result.commit}。`);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.store.load();
    const settings = this.store.settings;
    let workspacePath = settings.workspacePath || os.homedir();
    try {
      const stat = await lstat(workspacePath);
      if (!stat.isDirectory()) workspacePath = os.homedir();
    } catch {
      workspacePath = os.homedir();
    }
    const fallbackHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    this.state = {
      refreshedAt: new Date(0).toISOString(),
      connection: { status: "idle", label: "尚未连接" },
      workspacePath,
      codexHome: fallbackHome,
      skills: [],
      skillWarnings: [],
      hooks: [],
      hookWarnings: [],
      rateLimits: [],
      dailyTokenUsage: [],
      mcpServers: [],
      memory: emptyMemory,
      storage: [],
      backup: { cliAvailable: false, signedIn: false, detail: "尚未检查 GitHub CLI。", lastBackupAt: this.store.lastBackupAt },
      history: this.store.history,
      diagnostics: [],
      settings,
    };
    this.initialized = true;
    this.updateDiagnostics();
  }

  private async ensureConnection(): Promise<void> {
    if (this.codex.appServer.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      try {
        this.state.connection = { status: "locating", label: "正在查找 Codex" };
        this.emit();
        const executable = await locateCodex(this.store.settings.preferredCodexPath);
        if (!executable) throw new Error("没有找到 codex.exe；可在设置中手动选择。");
        this.state.codexExecutable = executable;
        this.state.connection = { status: "connecting", label: "正在连接 App Server" };
        this.emit();
        const info = await this.codex.connect(executable, app.getVersion());
        this.state.codexHome = path.resolve(info.codexHome);
        this.state.connection = { status: "connected", label: "Codex 已连接", userAgent: sanitize(info.userAgent), platform: sanitize(info.platformOS) };
      } catch (error) {
        this.state.connection = { status: "failed", label: "连接失败", error: sanitize((error as Error).message) };
        throw error;
      } finally {
        this.connecting = undefined;
      }
    })();
    return this.connecting;
  }

  private async refreshAll(forceReload: boolean): Promise<void> {
    try {
      await this.ensureConnection();
    } catch {
      // Local-only panels still work without App Server.
    }
    const remote = this.codex.appServer.connected
      ? [this.refreshSkills(forceReload), this.refreshHooks(), this.refreshUsage(), this.refreshMCP()]
      : [];
    await Promise.allSettled([...remote, this.refreshMemory(), this.refreshStorage(), this.refreshBackup()]);
    this.finishRefresh();
  }

  private async refreshSkills(forceReload: boolean): Promise<void> {
    try {
      const result = await this.codex.listSkills(this.state.workspacePath, forceReload);
      this.state.skills = result.skills;
      this.state.skillWarnings = result.warnings;
      this.skillError = undefined;
    } catch (error) {
      this.skillError = sanitize((error as Error).message);
      this.state.skillWarnings = [this.skillError];
    }
  }

  private async refreshHooks(): Promise<void> {
    try {
      const result = await this.codex.listHooks(this.state.workspacePath);
      this.state.hooks = result.hooks;
      this.state.hookWarnings = result.warnings;
      this.hookError = undefined;
    } catch (error) {
      this.hookError = sanitize((error as Error).message);
      this.state.hookWarnings = [this.hookError];
    }
  }

  private async refreshUsage(): Promise<void> {
    const result = await this.codex.readUsage();
    this.state.rateLimits = result.rateLimits;
    this.state.tokenUsage = result.tokenUsage;
    this.state.dailyTokenUsage = result.dailyTokenUsage;
    this.state.usageWarning = result.warning;
  }

  private async refreshMCP(): Promise<void> {
    try {
      const result = await this.codex.listMCP(this.state.workspacePath);
      this.state.mcpServers = result.servers;
      this.state.mcpWarning = result.warning;
    } catch (error) {
      this.state.mcpWarning = sanitize((error as Error).message);
    }
  }

  private async refreshMemory(): Promise<void> {
    try {
      this.state.memory = await scanMemory(this.state.codexHome);
      this.memoryError = undefined;
    } catch (error) {
      this.memoryError = sanitize((error as Error).message);
      this.state.memory = { ...emptyMemory, warnings: [this.memoryError] };
    }
  }

  private async refreshStorage(): Promise<void> {
    try {
      this.state.storage = await this.storage.scan(this.state.codexHome);
      this.storageError = undefined;
    } catch (error) {
      this.storageError = sanitize((error as Error).message);
    }
  }

  private async refreshBackup(): Promise<void> {
    try {
      this.state.backup = await this.backup.status(this.store.lastBackupAt);
      this.backupError = undefined;
    } catch (error) {
      this.backupError = sanitize((error as Error).message);
      this.state.backup = { cliAvailable: false, signedIn: false, detail: this.backupError, lastBackupAt: this.store.lastBackupAt };
    }
  }

  private updateDiagnostics(): void {
    const diagnostics: DiagnosticRecord[] = [];
    diagnostics.push(check(
      "connection", "Codex 连接",
      this.state.connection.status === "connected" ? "passed" : this.state.connection.status === "failed" ? "failed" : "checking",
      this.state.connection.status === "connected" ? `已连接 ${this.state.connection.userAgent ?? "Codex"}。` : this.state.connection.error ?? this.state.connection.label,
      "连接决定 Skills、Hooks、用量和 MCP 是否可以刷新。", "diagnostics",
    ));
    diagnostics.push(check("workspace", "当前工作区", "passed", this.state.workspacePath, "项目级配置会按此目录解析。", "dashboard"));
    diagnostics.push(check("skills", "Skills", this.skillError ? "failed" : "passed", this.skillError ?? `已读取 ${this.state.skills.length} 个 Skill。`, "停用项不会被误报为故障。", "skills"));
    diagnostics.push(check("hooks", "Hooks", this.hookError ? "failed" : this.state.hookWarnings.length ? "warning" : "passed", this.hookError ?? `已读取 ${this.state.hooks.length} 个 Hook，${this.state.hookWarnings.length} 条提示。`, "只展示当前连接可观察到的状态。", "hooks"));
    diagnostics.push(check("memory", "Memory", this.memoryError ? "failed" : this.state.memory.warnings.length ? "warning" : "passed", this.memoryError ?? `已识别 ${this.state.memory.visibleRecords.length} 个可读来源。`, "Memory 默认只读。", "memory"));
    diagnostics.push(check("usage", "账户用量", this.state.usageWarning ? "warning" : this.state.rateLimits.length || this.state.tokenUsage ? "passed" : "notChecked", this.state.usageWarning ?? "官方账户接口读取完成。", "缺失数据不会显示为 0。", "usage"));
    const mcpProblems = this.state.mcpServers.filter((item) => item.effectiveState === "problem").length;
    diagnostics.push(check("mcp", "MCP", mcpProblems ? "failed" : this.state.mcpWarning ? "warning" : "passed", mcpProblems ? `${mcpProblems} 个 MCP 存在配置问题。` : this.state.mcpWarning ?? `已检测 ${this.state.mcpServers.length} 个 MCP。`, "停用不等于故障。", "mcp"));
    diagnostics.push(check("storage", "本地存储", this.storageError ? "failed" : "passed", this.storageError ?? `已扫描 ${this.state.storage.length} 类数据，共 ${formatBytes(this.state.storage.reduce((sum, item) => sum + item.sizeBytes, 0))}。`, "受保护数据不开放清理。", "storage"));
    diagnostics.push(check("backup", "GitHub 备份", this.backupError || !this.state.backup.signedIn ? "warning" : "passed", this.backupError ?? this.state.backup.detail, "备份是可选功能。", "backup"));
    this.state.diagnostics = diagnostics;
  }

  private finishRefresh(): void {
    this.state.refreshedAt = new Date().toISOString();
    this.state.history = this.store.history;
    this.state.settings = this.store.settings;
    this.updateDiagnostics();
    this.emit();
  }

  private emit(): void {
    if (this.webContents && !this.webContents.isDestroyed()) this.webContents.send("workbench:snapshot", structuredClone(this.state));
  }

  private action(message: string): ActionResult {
    this.finishRefresh();
    return { ok: true, message, snapshot: structuredClone(this.state) };
  }
}

function check(id: string, title: string, status: DiagnosticRecord["status"], detail: string, impact: string, destination: SectionName): DiagnosticRecord {
  return { id, title, status, detail: sanitize(detail), impact, destination };
}

function modeTitle(mode: SkillMode): string {
  return mode === "implicit" ? "隐式（可自动匹配）" : mode === "explicit" ? "显式（仅点名）" : "隐藏";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
