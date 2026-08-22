import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  DailyTokenUsage,
  HookRecord,
  MCPRecord,
  RateLimitRecord,
  SkillDependency,
  SkillMode,
  SkillRecord,
  TokenUsageSummary,
} from "../../shared/types";
import { assertSafeRegularFile, commandSummary, isSafeConfigKey, sanitize } from "../security";
import { CodexAppServer, type CodexServerInfo } from "./codex-app-server";

type JsonObject = Record<string, any>;

interface ConfigLayer {
  name?: { type?: string };
  version?: string;
  config?: JsonObject;
}

interface ConfigReadResult {
  config?: JsonObject;
  layers?: ConfigLayer[];
}

export class CodexService {
  readonly appServer = new CodexAppServer();

  async connect(executable: string, version: string): Promise<CodexServerInfo> {
    return this.appServer.connect(executable, version);
  }

  async disconnect(): Promise<void> {
    await this.appServer.disconnect();
  }

  async listSkills(cwd: string, forceReload = false): Promise<{ skills: SkillRecord[]; warnings: string[] }> {
    const response = await this.appServer.request<JsonObject>("skills/list", { cwds: [cwd], forceReload });
    const entry = (response.data as JsonObject[] | undefined)?.find((item) => item.cwd === cwd) ?? response.data?.[0];
    if (!entry) return { skills: [], warnings: [] };
    const wireErrors = Array.isArray(entry.errors) ? entry.errors : [];
    const skills: SkillRecord[] = await Promise.all((Array.isArray(entry.skills) ? entry.skills : []).map(async (wire: JsonObject) => {
      const invocationPolicy = await readInvocationPolicy(String(wire.path ?? ""));
      const dependencies: SkillDependency[] = (wire.dependencies?.tools ?? []).map((dependency: JsonObject) => ({
        type: String(dependency.type ?? "unknown"),
        value: sanitize(dependency.value ?? ""),
        summary: dependency.description ? sanitize(dependency.description) : undefined,
        availability: dependency.type === "env_var"
          ? (process.env[String(dependency.value)] === undefined ? "missing" : "available")
          : "unknown",
      }));
      const errors = wireErrors
        .filter((error: JsonObject) => error.path === wire.path || String(wire.path ?? "").startsWith(String(error.path ?? "")))
        .map((error: JsonObject) => sanitize(error.message));
      const scope = skillScope(String(wire.scope ?? "unknown"));
      const isEnabled = wire.enabled !== false;
      const state = !isEnabled ? "disabled" : errors.length ? "error" : dependencies.some((item) => item.availability === "missing") ? "missingDependency" : "available";
      const mode = !isEnabled ? "hidden" : invocationPolicy === "explicitOnly" ? "explicit" : "implicit";
      const skillPath = String(wire.path ?? "");
      return {
        id: skillPath,
        name: sanitize(wire.name ?? "未命名 Skill"),
        displayName: sanitize(wire.interface?.displayName ?? wire.name ?? "未命名 Skill"),
        description: sanitize(wire.description ?? "没有提供说明。"),
        shortDescription: wire.interface?.shortDescription || wire.shortDescription
          ? sanitize(wire.interface?.shortDescription ?? wire.shortDescription)
          : undefined,
        path: skillPath,
        scope,
        rawScope: sanitize(wire.scope ?? "unknown"),
        isEnabled,
        invocationPolicy,
        mode,
        state,
        canModify: scope === "user" || scope === "repo",
        isPluginProvided: /[\\/]\.codex[\\/]plugins[\\/]/i.test(skillPath),
        dependencies,
        errors,
      };
    }));
    skills.sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-CN"));
    const warnings = wireErrors.map((error: JsonObject) => `${sanitize(path.basename(String(error.path ?? "")))}：${sanitize(error.message)}`);
    return { skills, warnings };
  }

  async listHooks(cwd: string): Promise<{ hooks: HookRecord[]; warnings: string[] }> {
    const response = await this.appServer.request<JsonObject>("hooks/list", { cwds: [cwd] });
    const entry = response.data?.find((item: JsonObject) => item.cwd === cwd) ?? response.data?.[0];
    if (!entry) return { hooks: [], warnings: [] };
    const hooks = (Array.isArray(entry.hooks) ? entry.hooks : [])
      .sort((left: JsonObject, right: JsonObject) => Number(left.displayOrder ?? 0) - Number(right.displayOrder ?? 0))
      .map((wire: JsonObject) => mapHook(wire));
    const warnings = [
      ...(Array.isArray(entry.warnings) ? entry.warnings.map(sanitize) : []),
      ...(Array.isArray(entry.errors) ? entry.errors.map((error: JsonObject) => `${path.basename(String(error.path ?? ""))}：${sanitize(error.message)}`) : []),
    ];
    return { hooks, warnings };
  }

  async readUsage(): Promise<{
    rateLimits: RateLimitRecord[];
    tokenUsage?: TokenUsageSummary;
    dailyTokenUsage: DailyTokenUsage[];
    warning?: string;
  }> {
    let rateLimits: RateLimitRecord[] = [];
    let tokenUsage: TokenUsageSummary | undefined;
    let dailyTokenUsage: DailyTokenUsage[] = [];
    const warnings: string[] = [];
    try {
      const response = await this.appServer.request<JsonObject>("account/rateLimits/read", null);
      const snapshots = response.rateLimitsByLimitId && Object.keys(response.rateLimitsByLimitId).length
        ? Object.entries(response.rateLimitsByLimitId)
        : [[response.rateLimits?.limitId ?? "codex", response.rateLimits]];
      rateLimits = snapshots.filter(([, value]) => value).map(([fallbackId, value]) => {
        const snapshot = value as JsonObject;
        return {
          id: String(snapshot.limitId ?? fallbackId),
          name: sanitize(snapshot.limitName ?? snapshot.limitId ?? fallbackId),
          planType: snapshot.planType ? sanitize(snapshot.planType) : undefined,
          primary: mapRateWindow(snapshot.primary),
          secondary: mapRateWindow(snapshot.secondary),
          reachedType: snapshot.rateLimitReachedType ? sanitize(snapshot.rateLimitReachedType) : undefined,
          creditBalance: snapshot.credits?.balance ? sanitize(snapshot.credits.balance) : undefined,
        };
      });
    } catch (error) {
      warnings.push(sanitize((error as Error).message));
    }
    try {
      const response = await this.appServer.request<JsonObject>("account/usage/read", null);
      if (response.summary) {
        tokenUsage = {
          lifetimeTokens: numberOrUndefined(response.summary.lifetimeTokens),
          peakDailyTokens: numberOrUndefined(response.summary.peakDailyTokens),
          longestRunningTurnSeconds: numberOrUndefined(response.summary.longestRunningTurnSec),
          currentStreakDays: numberOrUndefined(response.summary.currentStreakDays),
          longestStreakDays: numberOrUndefined(response.summary.longestStreakDays),
        };
      }
      dailyTokenUsage = (Array.isArray(response.dailyUsageBuckets) ? response.dailyUsageBuckets : []).map((item: JsonObject) => ({
        startDate: String(item.startDate),
        tokens: Number(item.tokens ?? 0),
      }));
    } catch (error) {
      warnings.push(sanitize((error as Error).message));
    }
    return { rateLimits, tokenUsage, dailyTokenUsage, warning: warnings.length ? warnings.join("；") : undefined };
  }

  async listMCP(cwd: string): Promise<{ servers: MCPRecord[]; warning?: string }> {
    const config = await this.readConfig(cwd);
    const configured: JsonObject = config.config?.mcp_servers ?? {};
    const inventory = new Map<string, JsonObject>();
    let warning: string | undefined;
    try {
      let cursor: string | undefined;
      const seen = new Set<string>();
      for (let page = 0; page < 20; page += 1) {
        const response = await this.appServer.request<JsonObject>("mcpServerStatus/list", {
          cursor: cursor ?? null,
          detail: "full",
          limit: 100,
          threadId: null,
        });
        for (const item of Array.isArray(response.data) ? response.data : []) inventory.set(String(item.name), item);
        cursor = response.nextCursor ? String(response.nextCursor) : undefined;
        if (!cursor) break;
        if (seen.has(cursor)) throw new Error("Codex 返回了重复的 MCP 分页游标。");
        seen.add(cursor);
      }
    } catch (error) {
      warning = `能力状态检测没有完成：${sanitize((error as Error).message)}`;
    }

    const names = new Set([...Object.keys(configured), ...inventory.keys()]);
    const checkedAt = new Date().toISOString();
    const servers = [...names].map((name): MCPRecord => {
      const values = configured[name] ?? {};
      const status = inventory.get(name);
      const isConfigured = Object.prototype.hasOwnProperty.call(configured, name);
      const isEnabled = values.enabled !== false;
      const isRequired = values.required === true;
      const permission = mcpPermission(name, config, isRequired);
      const url = typeof values.url === "string" ? values.url : undefined;
      const command = typeof values.command === "string" ? values.command : undefined;
      const transport = url ? "http" : command ? "stdio" : "unknown";
      const tools = Object.values(status?.tools ?? {}).map((tool: any) => ({
        name: sanitize(tool.name), title: tool.title ? sanitize(tool.title) : undefined, description: tool.description ? sanitize(tool.description) : undefined,
      })).sort((a: any, b: any) => (a.title ?? a.name).localeCompare(b.title ?? b.name, "zh-CN"));
      const resources = [
        ...(status?.resources ?? []).map((resource: JsonObject) => ({ name: sanitize(resource.name), title: resource.title ? sanitize(resource.title) : undefined, description: resource.description ? sanitize(resource.description) : undefined, kind: "resource" as const })),
        ...(status?.resourceTemplates ?? []).map((resource: JsonObject) => ({ name: sanitize(resource.name), title: resource.title ? sanitize(resource.title) : undefined, description: resource.description ? sanitize(resource.description) : undefined, kind: "template" as const })),
      ];
      const issue = mcpConfigurationIssue(url, command);
      const inventoryStatus = status ? "available" : warning ? "unavailable" : "notReported";
      const effectiveState = !isEnabled ? "disabled" : issue ? "problem" : status && (tools.length || resources.length) ? "effective" : "configured";
      return {
        id: name,
        name,
        displayName: sanitize(status?.serverInfo?.title ?? status?.serverInfo?.name ?? name),
        version: status?.serverInfo?.version ? sanitize(status.serverInfo.version) : undefined,
        description: status?.serverInfo?.description ? sanitize(status.serverInfo.description) : undefined,
        transport,
        endpointSummary: endpointSummary(url, command),
        isConfigured,
        isEnabled,
        isRequired,
        authStatus: sanitize(status?.authStatus ?? "unknown"),
        startupStatus: !isEnabled ? "disabled" : status ? "inventoryAvailable" : "configured",
        inventoryStatus,
        tools,
        resources,
        startupTimeoutSeconds: numberOrUndefined(values.startup_timeout_sec),
        toolTimeoutSeconds: numberOrUndefined(values.tool_timeout_sec),
        configurationIssue: issue,
        checkedAt,
        canModify: permission.allowed,
        readOnlyReason: permission.reason,
        effectiveState,
      };
    });
    servers.sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-CN"));
    return { servers, warning };
  }

  async setSkillMode(skill: SkillRecord, mode: SkillMode, cwd: string, codexHome: string): Promise<void> {
    if (!skill.canModify) throw new Error("系统或管理员 Skill 保持只读。");
    const allowedRoots = [path.join(codexHome, "skills"), path.join(codexHome, "plugins"), path.join(os.homedir(), ".agents", "skills")];
    if (skill.scope === "repo") allowedRoots.push(cwd);
    const safePath = await assertSafeRegularFile(skill.path, allowedRoots);
    if (mode === "hidden") {
      await this.appServer.request("skills/config/write", { path: safePath, enabled: false });
      return;
    }
    await this.appServer.request("skills/config/write", { path: safePath, enabled: true });
    await writeInvocationPolicy(safePath, mode === "implicit");
  }

  async setHookEnabled(hook: HookRecord, enabled: boolean, cwd: string): Promise<void> {
    if (!hook.canModify || !isSafeConfigKey(hook.key)) throw new Error("该 Hook 由系统或管理员管理，保持只读。");
    const config = await this.readConfig(cwd);
    const userLayer = config.layers?.find((layer) => layer.name?.type === "user");
    if (!userLayer?.version) throw new Error("Codex 没有返回可写的个人配置层。");
    const response = await this.appServer.request<JsonObject>("config/batchWrite", {
      edits: [{ keyPath: `hooks.state.${hook.key}.enabled`, value: enabled, mergeStrategy: "upsert" }],
      expectedVersion: userLayer.version,
      reloadUserConfig: true,
    });
    if (response.status !== "ok") throw new Error("Codex 没有确认配置写入成功。");
  }

  async setMCPEnabled(name: string, enabled: boolean, cwd: string): Promise<void> {
    if (!isSafeConfigKey(name)) throw new Error("MCP 名称包含不支持的字符。");
    const config = await this.readConfig(cwd);
    const required = config.config?.mcp_servers?.[name]?.required === true;
    const permission = mcpPermission(name, config, required);
    if (!permission.allowed) throw new Error(permission.reason ?? "该 MCP 保持只读。");
    const userLayer = config.layers?.find((layer) => layer.name?.type === "user");
    if (!userLayer?.version) throw new Error("Codex 没有返回可写的个人配置层。");
    const response = await this.appServer.request<JsonObject>("config/batchWrite", {
      edits: [{ keyPath: `mcp_servers.${name}.enabled`, value: enabled, mergeStrategy: "upsert" }],
      expectedVersion: userLayer.version,
      reloadUserConfig: false,
    });
    if (response.status !== "ok") throw new Error("Codex 没有确认配置写入成功。");
    const verified = await this.readConfig(cwd);
    if (verified.config?.mcp_servers?.[name]?.enabled !== enabled) throw new Error("重新读取后配置状态没有生效。");
  }

  async reloadMCP(): Promise<void> {
    await this.appServer.request("config/mcpServer/reload", null);
  }

  private async readConfig(cwd: string): Promise<ConfigReadResult> {
    return this.appServer.request<ConfigReadResult>("config/read", { cwd, includeLayers: true });
  }
}

function skillScope(value: string): SkillRecord["scope"] {
  return ["user", "repo", "system", "admin"].includes(value) ? value as SkillRecord["scope"] : "unknown";
}

async function readInvocationPolicy(skillPath: string): Promise<SkillRecord["invocationPolicy"]> {
  const directory = path.dirname(skillPath);
  for (const candidate of [path.join(directory, "SKILL.json"), path.join(directory, "agents", "openai.yaml"), path.join(directory, "agents", "openai.yml")]) {
    try {
      const stat = await lstat(candidate);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) continue;
      const contents = await readFile(candidate, "utf8");
      if (candidate.endsWith(".json")) {
        const value = JSON.parse(contents)?.policy?.allow_implicit_invocation;
        if (typeof value === "boolean") return value ? "automaticAllowed" : "explicitOnly";
      } else {
        const match = contents.match(/^\s*allow_implicit_invocation\s*:\s*(true|false)\s*$/im);
        if (match) return match[1].toLowerCase() === "true" ? "automaticAllowed" : "explicitOnly";
      }
    } catch {
      // Metadata is optional.
    }
  }
  return "automaticAllowed";
}

async function writeInvocationPolicy(skillPath: string, allowImplicit: boolean): Promise<void> {
  const agentsDirectory = path.join(path.dirname(skillPath), "agents");
  await mkdir(agentsDirectory, { recursive: true });
  const candidates = [path.join(agentsDirectory, "openai.yaml"), path.join(agentsDirectory, "openai.yml")];
  let target = candidates[0];
  let contents = "";
  for (const candidate of candidates) {
    try {
      const stat = await lstat(candidate);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw new Error("Skill 元数据路径不安全。");
      contents = await readFile(candidate, "utf8");
      target = candidate;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const replacement = `allow_implicit_invocation: ${allowImplicit ? "true" : "false"}`;
  let updated: string;
  if (/^\s*allow_implicit_invocation\s*:/m.test(contents)) {
    updated = contents.replace(/^(\s*)allow_implicit_invocation\s*:.*$/m, `$1${replacement}`);
  } else if (/^\s*policy\s*:\s*$/m.test(contents)) {
    updated = contents.replace(/^(\s*)policy\s*:\s*$/m, `$&\n$1  ${replacement}`);
  } else {
    updated = `${contents.trimEnd()}${contents.trim() ? "\n\n" : ""}policy:\n  ${replacement}\n`;
  }
  if (Buffer.byteLength(updated) > 256 * 1024) throw new Error("Skill 元数据文件过大。");
  await writeFile(target, updated, { encoding: "utf8", flag: "w" });
}

function mapHook(wire: JsonObject): HookRecord {
  const event = canonicalEvent(String(wire.eventName ?? "unknown"));
  const handlerType = String(wire.handlerType ?? "unknown");
  const source = String(wire.source ?? "unknown");
  const trustStatus = String(wire.trustStatus ?? "unknown");
  const isManaged = wire.isManaged === true || trustStatus === "managed" || ["mdm", "cloudManagedConfig", "cloudRequirements", "legacyManagedConfigFile", "legacyManagedConfigMdm"].includes(source);
  const isEnabled = wire.enabled !== false;
  const runnableState = !isEnabled ? "disabled" : handlerType !== "command" ? "unsupportedHandler" : isManaged || trustStatus === "trusted" ? "ready" : trustStatus === "modified" ? "changedSinceTrust" : "needsTrust";
  const name = hookDisplayName(wire);
  return {
    id: `${wire.sourcePath ?? ""}#${wire.key ?? ""}`,
    key: String(wire.key ?? ""),
    displayName: name,
    event,
    eventTitle: eventText(event).title,
    handlerType,
    handlerTitle: ({ command: "本地命令", prompt: "提示词处理器", agent: "代理处理器" } as Record<string, string>)[handlerType] ?? "未知处理器",
    matcher: wire.matcher ? sanitize(wire.matcher) : undefined,
    commandSummary: commandSummary(wire.command),
    timeoutSeconds: Number(wire.timeoutSec ?? 0),
    statusMessage: wire.statusMessage ? sanitize(wire.statusMessage) : undefined,
    sourcePath: String(wire.sourcePath ?? ""),
    source,
    sourceTitle: ({ system: "系统", user: "个人", project: "当前项目", mdm: "设备管理", sessionFlags: "本次会话", plugin: "插件", cloudRequirements: "云端策略", cloudManagedConfig: "云端策略" } as Record<string, string>)[source] ?? "未知来源",
    pluginId: wire.pluginId ? sanitize(wire.pluginId) : undefined,
    isEnabled,
    isManaged,
    canModify: !isManaged && isSafeConfigKey(String(wire.key ?? "")),
    trustStatus,
    trustTitle: ({ managed: "管理员托管", untrusted: "待信任", trusted: "已信任", modified: "信任后已修改" } as Record<string, string>)[trustStatus] ?? "信任状态未知",
    runnableState,
    triggerSummary: eventText(event).trigger,
    matchSummary: matchSummary(event, wire.matcher),
    actionSummary: wire.statusMessage ? sanitize(wire.statusMessage) : handlerType === "command" ? `运行本地处理器 ${commandSummary(wire.command) ?? "（名称未公开）"}。` : "当前 Codex 版本不会确认该处理器能够运行。",
    effectTitle: eventText(event).effectTitle,
    effectSummary: eventText(event).effect,
  };
}

function canonicalEvent(value: string): string {
  const canonical = value.replace(/[_-]/g, "").toLowerCase();
  return ({ pretooluse: "preToolUse", permissionrequest: "permissionRequest", posttooluse: "postToolUse", precompact: "preCompact", postcompact: "postCompact", sessionstart: "sessionStart", userpromptsubmit: "userPromptSubmit", subagentstart: "subagentStart", subagentstop: "subagentStop", stop: "stop" } as Record<string, string>)[canonical] ?? "unknown";
}

function eventText(event: string): { title: string; trigger: string; effectTitle: string; effect: string } {
  const values: Record<string, [string, string, string, string]> = {
    preToolUse: ["操作前检查", "Codex 准备调用工具、修改文件或使用 MCP 前触发。", "可以阻止或改写", "处理器可以允许、改写或拒绝调用，但它不是完整的安全边界。"],
    permissionRequest: ["审批前判断", "某个操作需要额外权限、审批提示出现前触发。", "可以决定审批", "处理器可以允许或拒绝，也可以交给正常审批流程。"],
    postToolUse: ["操作后复核", "受支持的工具返回结果后触发，失败也会触发。", "只能事后反馈", "工具已经运行，处理器不能撤销已经产生的影响。"],
    preCompact: ["压缩上下文前", "Codex 准备压缩当前上下文前触发。", "可以阻止压缩", "处理器可以在压缩发生前要求停止。"],
    postCompact: ["压缩上下文后", "Codex 完成上下文压缩后触发。", "压缩已经完成", "处理器只能影响后续流程。"],
    sessionStart: ["会话开始", "任务新建、恢复或压缩后重建上下文时触发。", "可以补充上下文", "处理器可以向新会话补充上下文或提醒。"],
    userPromptSubmit: ["提交提示词", "每次提示词即将提交给 Codex 时触发。", "可以补充或阻止", "处理器可以补充上下文或阻止提交。"],
    subagentStart: ["子代理启动", "每次子代理刚启动时触发。", "只能提醒", "处理器可补充上下文或提醒，但不能阻止启动。"],
    subagentStop: ["子代理结束", "子代理准备结束工作时触发。", "可以要求继续", "处理器可以要求子代理继续工作。"],
    stop: ["本轮即将结束", "Codex 准备结束当前这一轮回答时触发。", "可以要求继续", "处理器可以要求 Codex 再继续一轮。"],
    unknown: ["未知事件", "当前 Codex 版本没有提供已知触发说明。", "影响范围未知", "当前无法确认这个事件能如何影响 Codex 流程。"],
  };
  const [title, trigger, effectTitle, effect] = values[event] ?? values.unknown;
  return { title, trigger, effectTitle, effect };
}

function matchSummary(event: string, matcher?: unknown): string {
  const value = String(matcher ?? "").trim();
  const all = !value || value === "*";
  if (["preToolUse", "permissionRequest", "postToolUse"].includes(event)) return all ? "匹配所有受支持的终端、文件和 MCP 调用。" : `只匹配：${sanitize(value)}`;
  if (["userPromptSubmit", "stop"].includes(event)) return "每次都会触发。";
  return all ? "匹配该事件的所有发生情况。" : `匹配条件：${sanitize(value)}`;
}

function hookDisplayName(wire: JsonObject): string {
  const command = String(wire.command ?? "").toLowerCase();
  if (command.includes("safety-net")) return "Safety Net 安全检查";
  if (command.includes("vibe-island-bridge")) return "Vibe Island 状态同步";
  if (command.includes("subagent-policy-audit")) return "子代理配置审计";
  if (wire.pluginId) return `${sanitize(wire.pluginId)} 提供的 Hook`;
  return commandSummary(wire.command) ?? `Hook ${sanitize(String(wire.key ?? "")).slice(-16)}`;
}

function mapRateWindow(value: JsonObject | undefined): RateLimitRecord["primary"] {
  if (!value) return undefined;
  const usedPercent = Number(value.usedPercent ?? 0);
  return {
    usedPercent,
    remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
    windowDurationMinutes: numberOrUndefined(value.windowDurationMins),
    resetsAt: value.resetsAt ? new Date(Number(value.resetsAt) * 1000).toISOString() : undefined,
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function endpointSummary(url?: string, command?: string): string {
  if (url) {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    } catch {
      return "地址无效";
    }
  }
  return commandSummary(command) ?? "未公开";
}

function mcpConfigurationIssue(url?: string, command?: string): string | undefined {
  if (url) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) throw new Error();
      return undefined;
    } catch {
      return "远程地址不是有效的 HTTP 或 HTTPS URL。";
    }
  }
  if (command?.trim()) return undefined;
  return "配置缺少远程地址或本地启动命令。";
}

function mcpPermission(name: string, config: ConfigReadResult, required: boolean): { allowed: boolean; reason?: string } {
  if (!isSafeConfigKey(name)) return { allowed: false, reason: "名称包含不支持的字符。" };
  if (required) return { allowed: false, reason: "这是 Codex 启动必需的 MCP。" };
  const layers = config.layers ?? [];
  const defining = layers.filter((layer) => layer.config?.mcp_servers?.[name] !== undefined);
  if (!defining.some((layer) => layer.name?.type === "user")) return { allowed: false, reason: "不属于可写的个人配置层。" };
  if (defining.some((layer) => layer.name?.type !== "user")) return { allowed: false, reason: "同时由系统或管理员配置。" };
  return { allowed: true };
}
