import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Archive,
  ArrowUpRight,
  Brain,
  CheckCircle2,
  CircleAlert,
  Clipboard,
  Clock3,
  Database,
  Download,
  FolderOpen,
  Gauge,
  Github,
  HardDrive,
  History,
  Info,
  KeyRound,
  PackageOpen,
  RefreshCw,
  RotateCw,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Trash2,
  Unplug,
  WandSparkles,
  Webhook,
} from "lucide-react";
import type {
  ActionResult,
  HookRecord,
  MCPRecord,
  MemoryRecord,
  SectionName,
  SkillMode,
  SkillRecord,
  StorageRecord,
  WorkbenchSettings,
  WorkbenchSnapshot,
  WorkbenchUpdateState,
} from "../../shared/types";
import {
  Badge,
  DetailBlock,
  EmptyState,
  formatBytes,
  formatCompact,
  formatDate,
  KeyValue,
  Metric,
  PageHeader,
  ProgressBar,
  SearchBox,
  Segmented,
  SelectRow,
  SplitView,
  StatusIcon,
  Toggle,
  type Tone,
} from "../components/ui";

export interface PageActions {
  busy: string | null;
  run(key: string, task: () => Promise<ActionResult>): Promise<void>;
  refresh(section?: SectionName, force?: boolean): Promise<void>;
  chooseWorkspace(): Promise<void>;
  chooseCodex(): Promise<void>;
  navigate(section: SectionName): void;
  notify(message: string, tone?: "good" | "bad"): void;
}

export function DashboardPage({ snapshot, actions }: { snapshot: WorkbenchSnapshot; actions: PageActions }) {
  const skillProblems = snapshot.skills.filter((item) => item.state === "error" || item.state === "missingDependency").length;
  const hookProblems = snapshot.hooks.filter((item) => !["ready", "disabled"].includes(item.runnableState)).length;
  const mcpProblems = snapshot.mcpServers.filter((item) => item.effectiveState === "problem").length;
  const totalStorage = snapshot.storage.reduce((sum, item) => sum + item.sizeBytes, 0);
  const reclaimable = snapshot.storage.reduce((sum, item) => sum + item.reclaimableSizeBytes, 0);
  const usageWindows = snapshot.rateLimits.flatMap((limit) => [
    limit.primary && { id: `${limit.id}-primary`, name: `${limit.name} · 短周期`, window: limit.primary },
    limit.secondary && { id: `${limit.id}-secondary`, name: `${limit.name} · 长周期`, window: limit.secondary },
  ].filter(Boolean) as Array<{ id: string; name: string; window: NonNullable<typeof limit.primary> }>).slice(0, 2);

  return <div className="page-scroll">
    <PageHeader eyebrow="LOCAL CONTROL PLANE" title="Codex 总览" description="用一页看清账号用量、扩展能力和本机占用。" actions={<Badge tone={snapshot.connection.status === "connected" ? "good" : snapshot.connection.status === "failed" ? "bad" : "info"} dot>{snapshot.connection.label}</Badge>} />

    <section className="section-stack">
      <div className="section-heading"><div><h2>最近使用量</h2><p>来自 Codex 官方账户接口，不从日志估算费用。</p></div><button className="link-button" onClick={() => actions.navigate("usage")}>查看详情</button></div>
      <div className="usage-overview card">
        <div className="usage-windows">
          {usageWindows.length ? usageWindows.map((item) => <div className="usage-window" key={item.id}>
            <div><strong>{item.name}</strong><span>剩余 {item.window.remainingPercent}%</span></div>
            <ProgressBar value={item.window.remainingPercent} tone={item.window.remainingPercent < 15 ? "bad" : item.window.remainingPercent < 35 ? "warn" : "good"} />
            <small>{item.window.resetsAt ? `${formatDate(item.window.resetsAt)} 重置` : "未提供重置时间"}</small>
          </div>) : <EmptyState title="没有可显示的用量窗口" detail={snapshot.usageWarning ?? "当前登录方式可能不提供该接口。"} />}
        </div>
        <div className="usage-numbers">
          <div><strong>{formatCompact(snapshot.dailyTokenUsage.slice(-7).reduce((sum, item) => sum + item.tokens, 0) || undefined)}</strong><span>近 7 天 Token</span></div>
          <div><strong>{formatCompact(snapshot.tokenUsage?.lifetimeTokens)}</strong><span>累计 Token</span></div>
          <div><strong>{snapshot.tokenUsage?.currentStreakDays ?? "—"}</strong><span>连续使用天数</span></div>
        </div>
      </div>
    </section>

    <section className="section-stack">
      <div className="section-heading"><div><h2>能力状态</h2><p>“停用”与“未生效”会分开显示，只有真实异常才标红。</p></div></div>
      <div className="capability-grid">
        <CapabilityCard title="Skills" count={snapshot.skills.length} icon={<WandSparkles size={20} />} tone={skillProblems ? "bad" : snapshot.skills.length ? "good" : "neutral"} state={skillProblems ? `${skillProblems} 个问题` : "状态正常"} detail={`${snapshot.skills.filter((item) => item.mode === "implicit").length} 个可自动匹配 · ${snapshot.skills.filter((item) => item.mode === "explicit").length} 个仅点名`} onClick={() => actions.navigate("skills")} />
        <CapabilityCard title="Hooks" count={snapshot.hooks.length} icon={<Webhook size={20} />} tone={hookProblems ? "bad" : snapshot.hooks.length ? "good" : "neutral"} state={hookProblems ? `${hookProblems} 个待确认` : "状态正常"} detail={`${snapshot.hooks.filter((item) => item.runnableState === "ready").length} 个可以运行 · ${snapshot.hooks.filter((item) => item.runnableState === "disabled").length} 个停用`} onClick={() => actions.navigate("hooks")} />
        <CapabilityCard title="MCP" count={snapshot.mcpServers.length} icon={<Server size={20} />} tone={mcpProblems ? "bad" : snapshot.mcpWarning ? "warn" : snapshot.mcpServers.length ? "good" : "neutral"} state={mcpProblems ? `${mcpProblems} 个配置问题` : snapshot.mcpWarning ? "读取不完整" : "状态正常"} detail={`${snapshot.mcpServers.filter((item) => item.effectiveState === "effective").length} 个已生效 · ${snapshot.mcpServers.filter((item) => item.isEnabled).length} 个启用`} onClick={() => actions.navigate("mcp")} />
        <CapabilityCard title="Memory" count={snapshot.memory.visibleRecords.length} icon={<Brain size={20} />} tone={snapshot.memory.warnings.length ? "warn" : snapshot.memory.visibleRecords.length ? "good" : "neutral"} state={snapshot.memory.warnings.length ? `${snapshot.memory.warnings.length} 条提示` : "只读可见"} detail={`${formatBytes(snapshot.memory.totalBytes)} · 原始材料默认隐藏`} onClick={() => actions.navigate("memory")} />
      </div>
    </section>

    <section className="section-stack">
      <div className="section-heading"><div><h2>本机存储</h2><p>先看整体占用，再进入存储页处理白名单内的数据。</p></div><button className="link-button" onClick={() => actions.navigate("storage")}>管理存储</button></div>
      <div className="storage-overview card">
        <div className="storage-summary"><div><strong>{formatBytes(totalStorage)}</strong><span>Codex 本地总占用</span></div><div><strong>{formatBytes(reclaimable)}</strong><span>当前可回收</span></div></div>
        <div className="storage-stack" aria-label="存储占用分布">{snapshot.storage.filter((item) => item.sizeBytes > 0).map((item) => <span key={item.id} className={`storage-color storage-${item.kind}`} style={{ width: `${Math.max(1, totalStorage ? item.sizeBytes / totalStorage * 100 : 0)}%` }} title={`${item.title} ${formatBytes(item.sizeBytes)}`} />)}</div>
        <div className="storage-legend">{snapshot.storage.slice(0, 6).map((item) => <span key={item.id}><i className={`storage-${item.kind}`} />{item.title}<b>{formatBytes(item.sizeBytes)}</b></span>)}</div>
      </div>
    </section>
  </div>;
}

function CapabilityCard({ title, count, icon, tone, state, detail, onClick }: { title: string; count: number; icon: ReactNode; tone: Tone; state: string; detail: string; onClick: () => void }) {
  return <button className="capability-card" onClick={onClick}><div className="capability-top"><span className={`capability-icon tone-${tone}`}>{icon}</span><Badge tone={tone} dot>{state}</Badge></div><strong className="capability-count">{count}</strong><h3>{title}</h3><p>{detail}</p></button>;
}

export function SkillsPage({ snapshot, actions }: { snapshot: WorkbenchSnapshot; actions: PageActions }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | SkillMode | "problem">("all");
  const filtered = snapshot.skills.filter((skill) => {
    const matchesSearch = `${skill.displayName} ${skill.description} ${skill.path}`.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "all" || filter === "problem" ? filter === "all" || ["error", "missingDependency"].includes(skill.state) : skill.mode === filter;
    return matchesSearch && matchesFilter;
  });
  const [selectedId, setSelectedId] = useState<string>();
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0];

  return <div className="page-full">
    <PageHeader eyebrow="CAPABILITY MAP" title="Skills" description="查看用途、来源、依赖和调用方式；三态控制比“开/关”更准确。" />
    <div className="filter-bar"><SearchBox value={search} onChange={setSearch} placeholder="搜索名称、说明或路径" /><div className="filter-pills">{(["all", "implicit", "explicit", "hidden", "problem"] as const).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{({ all: "全部", implicit: "隐式", explicit: "显式", hidden: "隐藏", problem: "有问题" } as const)[value]}</button>)}</div></div>
    <SplitView
      list={<>{filtered.length ? filtered.map((skill) => <SelectRow key={skill.id} selected={selected?.id === skill.id} onClick={() => setSelectedId(skill.id)} title={skill.displayName} subtitle={skill.shortDescription ?? skill.description} leading={<span className={`state-orb state-${skill.state}`} />} trailing={<Badge tone={skillTone(skill)}>{modeTitle(skill.mode)}</Badge>} />) : <EmptyState icon={<Sparkles />} title="没有匹配的 Skill" detail="调整筛选条件或重新扫描当前工作区。" />}</>}
      detail={selected ? <SkillDetail skill={selected} actions={actions} /> : <EmptyState title="选择一个 Skill" detail="右侧会解释它何时可用以及由谁提供。" />}
    />
  </div>;
}

function SkillDetail({ skill, actions }: { skill: SkillRecord; actions: PageActions }) {
  const changing = actions.busy === `skill:${skill.id}`;
  return <div className="inspector">
    <div className="inspector-title"><div><Badge tone={skillTone(skill)} dot>{skillStateTitle(skill)}</Badge><h2>{skill.displayName}</h2><p>{skill.description}</p></div><button className="icon-button" title="在资源管理器中打开" onClick={() => actions.run(`open:${skill.id}`, () => window.workbench.openPath(skill.path))}><FolderOpen size={18} /></button></div>
    <DetailBlock title="调用方式"><Segmented<SkillMode> value={skill.mode} disabled={!skill.canModify || changing} options={[{ value: "implicit", label: "隐式" }, { value: "explicit", label: "显式" }, { value: "hidden", label: "隐藏" }]} onChange={(mode) => actions.run(`skill:${skill.id}`, () => window.workbench.setSkillMode(skill.id, mode))} /><p className="help-text">{skill.mode === "implicit" ? "Codex 可自动匹配，也可用 $名称 点名。" : skill.mode === "explicit" ? "仅在提示词中点名时使用。" : "不参与自动匹配，点名也不会加载。"}</p>{!skill.canModify && <p className="inline-warning"><ShieldCheck size={15} />系统或管理员提供的 Skill 保持只读。</p>}</DetailBlock>
    <DetailBlock title="来源"><KeyValue label="范围" value={scopeTitle(skill.scope)} /><KeyValue label="提供方式" value={skill.isPluginProvided ? "插件" : "独立 Skill"} /><KeyValue label="文件" value={skill.path} mono /></DetailBlock>
    <DetailBlock title={`依赖 · ${skill.dependencies.length}`}>{skill.dependencies.length ? <div className="dependency-list">{skill.dependencies.map((dependency, index) => <div key={`${dependency.type}-${dependency.value}-${index}`}><span className={`state-orb state-${dependency.availability === "missing" ? "error" : "available"}`} /><div><strong>{dependency.value}</strong><small>{dependency.summary ?? dependency.type}</small></div><Badge tone={dependency.availability === "missing" ? "bad" : dependency.availability === "available" ? "good" : "neutral"}>{dependency.availability === "missing" ? "缺少" : dependency.availability === "available" ? "可用" : "待确认"}</Badge></div>)}</div> : <p className="muted">没有声明外部工具依赖。</p>}</DetailBlock>
    {skill.errors.length > 0 && <DetailBlock title="问题"><div className="warning-list">{skill.errors.map((error) => <p key={error}><CircleAlert size={15} />{error}</p>)}</div></DetailBlock>}
  </div>;
}

export function HooksPage({ snapshot, actions }: { snapshot: WorkbenchSnapshot; actions: PageActions }) {
  const [search, setSearch] = useState("");
  const filtered = snapshot.hooks.filter((hook) => `${hook.displayName} ${hook.eventTitle} ${hook.sourceTitle}`.toLowerCase().includes(search.toLowerCase()));
  const [selectedId, setSelectedId] = useState<string>();
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0];
  return <div className="page-full"><PageHeader eyebrow="EVENT CHAIN" title="Hooks" description="看清触发时机、处理器、影响范围和信任状态；这里只显示当前连接能验证的内容。" /><div className="filter-bar"><SearchBox value={search} onChange={setSearch} placeholder="搜索 Hook 或事件" /><Badge tone={snapshot.hookWarnings.length ? "warn" : "good"}>{snapshot.hookWarnings.length ? `${snapshot.hookWarnings.length} 条提示` : "配置已读取"}</Badge></div><SplitView list={<>{filtered.length ? filtered.map((hook) => <SelectRow key={hook.id} selected={selected?.id === hook.id} onClick={() => setSelectedId(hook.id)} title={hook.displayName} subtitle={`${hook.eventTitle} · ${hook.sourceTitle}`} leading={<span className={`state-orb state-${hook.runnableState}`} />} trailing={<Badge tone={hookTone(hook)}>{hookRunTitle(hook.runnableState)}</Badge>} />) : <EmptyState icon={<Webhook />} title="没有发现 Hook" detail="当前工作区没有有效 Hook，或 Codex 尚未提供该能力。" />}</>} detail={selected ? <HookDetail hook={selected} actions={actions} /> : <EmptyState title="选择一个 Hook" detail="右侧会解释事件链和实际影响。" />} /></div>;
}

function HookDetail({ hook, actions }: { hook: HookRecord; actions: PageActions }) {
  return <div className="inspector"><div className="inspector-title"><div><Badge tone={hookTone(hook)} dot>{hookRunTitle(hook.runnableState)}</Badge><h2>{hook.displayName}</h2><p>{hook.actionSummary}</p></div><Toggle checked={hook.isEnabled} disabled={!hook.canModify || actions.busy === `hook:${hook.id}`} label={`${hook.isEnabled ? "停用" : "启用"} ${hook.displayName}`} onChange={(enabled) => actions.run(`hook:${hook.id}`, () => window.workbench.setHookEnabled(hook.id, enabled))} /></div><div className="event-flow"><div><span>1</span><strong>{hook.eventTitle}</strong><small>{hook.triggerSummary}</small></div><i /><div><span>2</span><strong>{hook.handlerTitle}</strong><small>{hook.commandSummary ?? "处理器名称未公开"}</small></div><i /><div><span>3</span><strong>{hook.effectTitle}</strong><small>{hook.effectSummary}</small></div></div><DetailBlock title="匹配范围"><p>{hook.matchSummary}</p></DetailBlock><DetailBlock title="信任与来源"><KeyValue label="状态" value={hook.trustTitle} /><KeyValue label="来源" value={hook.sourceTitle} /><KeyValue label="超时" value={`${hook.timeoutSeconds} 秒`} /><KeyValue label="配置文件" value={hook.sourcePath || "未公开"} mono />{hook.isManaged && <p className="inline-warning"><ShieldCheck size={15} />由系统或管理员托管，Workbench 不会修改。</p>}</DetailBlock></div>;
}

export function MemoryPage({ snapshot, actions }: { snapshot: WorkbenchSnapshot; actions: PageActions }) {
  const [selectedId, setSelectedId] = useState<string>();
  const selected = snapshot.memory.visibleRecords.find((item) => item.id === selectedId) ?? snapshot.memory.visibleRecords[0];
  return <div className="page-full"><PageHeader eyebrow="READ-ONLY MEMORY" title="Memory" description="把 Codex 已保存的摘要和长期记忆变成可读来源；原始材料、凭据和敏感行默认隐藏。" actions={<Badge tone="info"><ShieldCheck size={13} />只读模式</Badge>} /><div className="memory-summary"><Metric label="可读来源" value={String(snapshot.memory.visibleRecords.length)} hint={`${snapshot.memory.records.length} 个文件已扫描`} icon={<Brain size={20} />} /><Metric label="总大小" value={formatBytes(snapshot.memory.totalBytes)} hint="大文件只展示元数据" icon={<Archive size={20} />} /><Metric label="扫描提示" value={String(snapshot.memory.warnings.length)} hint={snapshot.memory.warnings[0] ?? "没有发现异常"} icon={<CircleAlert size={20} />} /></div><SplitView list={<>{snapshot.memory.visibleRecords.length ? snapshot.memory.visibleRecords.map((record) => <SelectRow key={record.id} selected={selected?.id === record.id} onClick={() => setSelectedId(record.id)} title={record.title} subtitle={`${memoryKindTitle(record.kind)} · ${formatBytes(record.sizeBytes)}`} leading={<Brain size={16} />} trailing={<Badge tone={record.status === "available" ? "good" : record.status === "tooLarge" ? "warn" : "bad"}>{record.status === "available" ? "可读" : record.status === "tooLarge" ? "过大" : "不可读"}</Badge>} />) : <EmptyState icon={<Brain />} title="尚无可展示的 Memory" detail={snapshot.memory.warnings[0] ?? "Codex 还没有生成 Memory 来源。"} />}</>} detail={selected ? <MemoryDetail record={selected} actions={actions} /> : <EmptyState title="选择一个来源" detail="右侧会显示脱敏后的预览和文件证据。" />} /></div>;
}

function MemoryDetail({ record, actions }: { record: MemoryRecord; actions: PageActions }) {
  return <div className="inspector"><div className="inspector-title"><div><Badge tone={record.kind === "active" ? "good" : "info"}>{memoryKindTitle(record.kind)}</Badge><h2>{record.title}</h2><p>{record.relativePath}</p></div><button className="icon-button" onClick={() => actions.run(`memory:${record.id}`, () => window.workbench.openPath(record.absolutePath))}><FolderOpen size={18} /></button></div><DetailBlock title="内容预览">{record.preview ? <pre className="memory-preview">{record.preview}</pre> : <EmptyState title={record.status === "tooLarge" ? "文件超过安全预览上限" : "没有可用预览"} detail="Workbench 不会为不可验证的内容生成摘要。" />}</DetailBlock><DetailBlock title="来源证据"><KeyValue label="位置" value={record.absolutePath} mono /><KeyValue label="行数" value={record.lineCount || "未统计"} /><KeyValue label="修改时间" value={formatDate(record.modifiedAt)} /><KeyValue label="大小" value={formatBytes(record.sizeBytes)} /></DetailBlock></div>;
}

export function UsagePage({ snapshot }: { snapshot: WorkbenchSnapshot; actions: PageActions }) {
  const days = snapshot.dailyTokenUsage.slice(-30);
  const maximum = Math.max(1, ...days.map((item) => item.tokens));
  return <div className="page-scroll"><PageHeader eyebrow="OFFICIAL ACCOUNT DATA" title="账户用量" description="只展示 Codex 官方接口返回的限额与 Token 活动，不估算美元费用或模型占比。" /><div className="metric-grid"><Metric label="累计 Token" value={formatCompact(snapshot.tokenUsage?.lifetimeTokens)} hint="账号可见生命周期" icon={<Gauge size={21} />} /><Metric label="单日峰值" value={formatCompact(snapshot.tokenUsage?.peakDailyTokens)} hint="官方汇总" icon={<ArrowUpRight size={21} />} /><Metric label="当前连续" value={snapshot.tokenUsage?.currentStreakDays === undefined ? "不可用" : `${snapshot.tokenUsage.currentStreakDays} 天`} hint={`最长 ${snapshot.tokenUsage?.longestStreakDays ?? "—"} 天`} icon={<Clock3 size={21} />} /></div><section className="section-stack"><div className="section-heading"><div><h2>限额窗口</h2><p>进度条显示剩余额度，而不是已使用额度。</p></div></div><div className="rate-grid">{snapshot.rateLimits.length ? snapshot.rateLimits.map((limit) => <div className="card rate-card" key={limit.id}><div className="rate-title"><div><h3>{limit.name}</h3><span>{limit.planType ?? "当前计划"}</span></div>{limit.reachedType && <Badge tone="bad">已触达限制</Badge>}</div>{limit.primary && <RateWindow title="短周期" window={limit.primary} />}{limit.secondary && <RateWindow title="长周期" window={limit.secondary} />}{limit.creditBalance && <KeyValue label="Credits" value={limit.creditBalance} />}</div>) : <div className="card"><EmptyState icon={<Gauge />} title="没有可显示的限额窗口" detail={snapshot.usageWarning ?? "当前账号未返回限额数据。"} /></div>}</div></section><section className="section-stack"><div className="section-heading"><div><h2>每日 Token</h2><p>最近 {days.length || 0} 天的官方活动桶。</p></div></div><div className="card usage-chart">{days.length ? <>{days.map((item) => <div className="chart-column" key={item.startDate} title={`${item.startDate}: ${item.tokens.toLocaleString("zh-CN")}`}><span style={{ height: `${Math.max(3, item.tokens / maximum * 100)}%` }} /><small>{item.startDate.slice(5)}</small></div>)}</> : <EmptyState title="没有每日活动数据" detail="缺失不会被显示为 0。" />}</div></section>{snapshot.usageWarning && <p className="inline-warning"><CircleAlert size={15} />{snapshot.usageWarning}</p>}</div>;
}

function RateWindow({ title, window }: { title: string; window: { remainingPercent: number; resetsAt?: string; windowDurationMinutes?: number } }) {
  const tone: Tone = window.remainingPercent < 15 ? "bad" : window.remainingPercent < 35 ? "warn" : "good";
  return <div className="rate-window"><div><strong>{title}</strong><span className={`text-${tone}`}>剩余 {window.remainingPercent}%</span></div><ProgressBar value={window.remainingPercent} tone={tone} /><small>{window.resetsAt ? `${formatDate(window.resetsAt)} 重置` : window.windowDurationMinutes ? `${window.windowDurationMinutes} 分钟周期` : "未提供重置时间"}</small></div>;
}

export function MCPPage({ snapshot, actions }: { snapshot: WorkbenchSnapshot; actions: PageActions }) {
  const [search, setSearch] = useState("");
  const filtered = snapshot.mcpServers.filter((server) => `${server.displayName} ${server.description ?? ""} ${server.endpointSummary}`.toLowerCase().includes(search.toLowerCase()));
  const [selectedId, setSelectedId] = useState<string>();
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0];
  return <div className="page-full"><PageHeader eyebrow="TOOL NETWORK" title="MCP" description="区分“写进配置”“已启用”和“实际暴露能力”，不把一段配置当作连接成功。" actions={<button className="secondary-button" disabled={actions.busy === "mcp:reload"} onClick={() => actions.run("mcp:reload", () => window.workbench.reloadMCP())}><RotateCw size={15} />重新载入全部</button>} /><div className="filter-bar"><SearchBox value={search} onChange={setSearch} placeholder="搜索服务、说明或端点" />{snapshot.mcpWarning ? <Badge tone="warn">状态不完整</Badge> : <Badge tone="good">能力已读取</Badge>}</div><SplitView list={<>{filtered.length ? filtered.map((server) => <SelectRow key={server.id} selected={selected?.id === server.id} onClick={() => setSelectedId(server.id)} title={server.displayName} subtitle={`${server.transport.toUpperCase()} · ${server.endpointSummary}`} leading={<Server size={16} />} trailing={<Badge tone={mcpTone(server)}>{mcpStateTitle(server)}</Badge>} />) : <EmptyState icon={<Unplug />} title="没有发现 MCP" detail="当前配置和运行时均未返回 MCP 服务。" />}</>} detail={selected ? <MCPDetail server={selected} actions={actions} /> : <EmptyState title="选择一个 MCP" detail="右侧会显示配置、连接与能力清单。" />} /></div>;
}

function MCPDetail({ server, actions }: { server: MCPRecord; actions: PageActions }) {
  return <div className="inspector"><div className="inspector-title"><div><Badge tone={mcpTone(server)} dot>{mcpStateTitle(server)}</Badge><h2>{server.displayName}</h2><p>{server.description ?? "该服务没有提供说明。"}</p></div><Toggle checked={server.isEnabled} disabled={!server.canModify || actions.busy === `mcp:${server.name}`} label={`${server.isEnabled ? "停用" : "启用"} ${server.displayName}`} onChange={(enabled) => actions.run(`mcp:${server.name}`, () => window.workbench.setMCPEnabled(server.name, enabled))} /></div><div className="mcp-stage"><div className={server.isConfigured ? "complete" : ""}><span>1</span><strong>已配置</strong></div><i /><div className={server.isEnabled ? "complete" : ""}><span>2</span><strong>已启用</strong></div><i /><div className={server.inventoryStatus === "available" ? "complete" : ""}><span>3</span><strong>能力可见</strong></div></div><DetailBlock title="连接"><KeyValue label="传输" value={server.transport.toUpperCase()} /><KeyValue label="端点" value={server.endpointSummary} mono /><KeyValue label="认证" value={server.authStatus} /><KeyValue label="检查时间" value={formatDate(server.checkedAt)} />{server.configurationIssue && <p className="inline-error"><CircleAlert size={15} />{server.configurationIssue}</p>}{server.readOnlyReason && <p className="inline-warning"><ShieldCheck size={15} />{server.readOnlyReason}</p>}</DetailBlock><DetailBlock title={`工具 · ${server.tools.length}`}>{server.tools.length ? <div className="capability-list">{server.tools.map((tool) => <div key={tool.name}><TerminalSquare size={15} /><div><strong>{tool.title ?? tool.name}</strong><small>{tool.description ?? tool.name}</small></div></div>)}</div> : <p className="muted">运行时尚未暴露工具，不能据此假设工具可用。</p>}</DetailBlock><DetailBlock title={`资源 · ${server.resources.length}`}>{server.resources.length ? <div className="capability-list">{server.resources.map((resource) => <div key={`${resource.kind}-${resource.name}`}><Database size={15} /><div><strong>{resource.title ?? resource.name}</strong><small>{resource.kind === "template" ? "资源模板" : resource.description ?? "资源"}</small></div></div>)}</div> : <p className="muted">没有返回资源或资源模板。</p>}</DetailBlock></div>;
}

export function StoragePage({ snapshot, actions }: { snapshot: WorkbenchSnapshot; actions: PageActions }) {
  const total = snapshot.storage.reduce((sum, item) => sum + item.sizeBytes, 0);
  const reclaimable = snapshot.storage.reduce((sum, item) => sum + item.reclaimableSizeBytes, 0);
  async function clean(record: StorageRecord) {
    if (!record.cleanupFingerprint) return;
    const warning = record.cleanupLevel === "cautious" ? "这会把已归档会话移入 Windows 回收站。仍要继续吗？" : `将处理 ${formatBytes(record.reclaimableSizeBytes)} 的${record.title}并移入回收站。继续吗？`;
    if (!window.confirm(warning)) return;
    await actions.run(`storage:${record.kind}`, () => window.workbench.cleanupStorage(record.kind, record.cleanupFingerprint!));
  }
  return <div className="page-scroll"><PageHeader eyebrow="DISK SAFETY" title="本机存储" description="只对白名单目录开放清理，操作前重新扫描并校验内容是否变化。" /><div className="metric-grid"><Metric label="总占用" value={formatBytes(total)} hint={`${snapshot.storage.length} 类数据`} icon={<HardDrive size={21} />} /><Metric label="可回收" value={formatBytes(reclaimable)} hint="按年龄和类别筛选" icon={<Trash2 size={21} />} /><Metric label="受保护" value={formatBytes(snapshot.storage.filter((item) => item.cleanupLevel === "protected").reduce((sum, item) => sum + item.sizeBytes, 0))} hint="会话、数据库与能力包" icon={<ShieldCheck size={21} />} /></div><div className="storage-cards">{snapshot.storage.length ? snapshot.storage.map((record) => <div className="card storage-card" key={record.id}><div className="storage-card-icon"><span className={`storage-${record.kind}`}><StorageIcon kind={record.kind} /></span></div><div className="storage-card-body"><div><h3>{record.title}</h3><Badge tone={record.cleanupLevel === "safe" ? "good" : record.cleanupLevel === "cautious" ? "warn" : "neutral"}>{record.cleanupLevel === "safe" ? "安全清理" : record.cleanupLevel === "cautious" ? "谨慎处理" : "只读保护"}</Badge></div><strong>{formatBytes(record.sizeBytes)}</strong><p>{record.itemCount.toLocaleString("zh-CN")} 个文件 · {record.cleanupImpact}</p><small className="mono">{record.path}</small></div><div className="storage-card-action">{record.cleanupLevel !== "protected" ? <><span>{formatBytes(record.reclaimableSizeBytes)} 可回收</span><button className={record.cleanupLevel === "cautious" ? "danger-button" : "secondary-button"} disabled={!record.reclaimableItemCount || actions.busy === `storage:${record.kind}`} onClick={() => clean(record)}><Trash2 size={15} />{record.reclaimableItemCount ? "清理" : "无需清理"}</button></> : <ShieldCheck size={20} />}</div></div>) : <div className="card"><EmptyState icon={<HardDrive />} title="尚未读取存储" detail="请确认 Codex Home 存在并重新扫描。" /></div>}</div></div>;
}

function StorageIcon({ kind }: { kind: StorageRecord["kind"] }) {
  if (kind === "sessions" || kind === "archivedSessions") return <Archive size={20} />;
  if (["plugins", "skills", "packages"].includes(kind)) return <PackageOpen size={20} />;
  if (kind === "database") return <Database size={20} />;
  return <HardDrive size={20} />;
}

export function BackupPage({ snapshot, actions }: { snapshot: WorkbenchSnapshot; actions: PageActions }) {
  const [repository, setRepository] = useState(snapshot.settings.backupRepository ?? "");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof window.workbench.previewBackup>> | null>(null);
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => setRepository(snapshot.settings.backupRepository ?? ""), [snapshot.settings.backupRepository]);
  async function buildPreview() {
    try {
      setPreviewing(true);
      setPreview(await window.workbench.previewBackup(repository.trim()));
    } catch (error) {
      actions.notify(error instanceof Error ? error.message : "无法生成备份预览。", "bad");
    } finally {
      setPreviewing(false);
    }
  }
  return <div className="page-scroll"><PageHeader eyebrow="PRIVATE BACKUP" title="GitHub 备份" description="上传前先生成脱敏预览；Workbench 只接受已初始化的私人仓库。" /><div className="backup-status card"><span className={`backup-mark ${snapshot.backup.signedIn ? "connected" : ""}`}><Github size={28} /></span><div><Badge tone={snapshot.backup.signedIn ? "good" : "warn"} dot>{snapshot.backup.signedIn ? "已连接" : "不可用"}</Badge><h2>{snapshot.backup.login ?? "GitHub CLI"}</h2><p>{snapshot.backup.detail}</p>{snapshot.backup.lastBackupAt && <small>上次备份：{formatDate(snapshot.backup.lastBackupAt)}</small>}</div></div><section className="backup-builder card"><div className="section-heading"><div><h2>目标私人仓库</h2><p>输入 owner/name；不会读取或保存 GitHub token。</p></div></div><label className="field-label">仓库<input value={repository} onChange={(event) => setRepository(event.target.value)} placeholder="your-name/codex-backup" /></label><div className="backup-safety"><ShieldCheck size={20} /><div><strong>上传边界</strong><p>仅备份 config.toml、AGENTS.md、默认规则和个人 Skills 定义；疑似凭据行会被替换。</p></div></div><button className="primary-button" disabled={!snapshot.backup.signedIn || !repository.trim() || previewing} onClick={buildPreview}>{previewing ? <RefreshCw className="spin" size={16} /> : <Clipboard size={16} />}生成脱敏预览</button></section>{preview && <div className="modal-backdrop" onMouseDown={() => setPreview(null)}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><div className="eyebrow">READY TO REVIEW</div><h2>备份预览</h2><p>{preview.repository}</p></div><Badge tone="warn">上传前确认</Badge></div><div className="preview-files">{preview.files.map((file) => <div key={file.path}><CheckCircle2 size={16} /><div><strong className="mono">{file.path}</strong><small>{file.note}</small></div><span>{formatBytes(file.sizeBytes)}</span></div>)}</div><div className="warning-list">{preview.warnings.map((warning) => <p key={warning}><Info size={15} />{warning}</p>)}</div><div className="modal-actions"><button className="secondary-button" onClick={() => setPreview(null)}>取消</button><button className="primary-button" disabled={actions.busy === "backup:run"} onClick={async () => { await actions.run("backup:run", () => window.workbench.runBackup(preview.repository)); setPreview(null); }}><Github size={16} />确认上传到私人仓库</button></div></div></div>}</div>;
}

export function HistoryPage({ snapshot }: { snapshot: WorkbenchSnapshot; actions: PageActions }) {
  return <div className="page-scroll"><PageHeader eyebrow="LOCAL AUDIT TRAIL" title="变更记录" description="只记录 Workbench 发起的本地变更，不把 Codex 的全部历史伪装成可观察状态。" /><div className="timeline card">{snapshot.history.length ? snapshot.history.map((record) => <div className="timeline-row" key={record.id}><div className={`timeline-dot timeline-${record.category}`}><History size={15} /></div><div><span>{formatDate(record.at)}</span><h3>{record.title}</h3><p>{record.detail}</p></div><Badge tone={record.reversible ? "info" : "neutral"}>{record.reversible ? "可追溯" : "记录"}</Badge></div>) : <EmptyState icon={<History />} title="尚无变更记录" detail="通过 Workbench 调整 Skill、Hook、MCP 或存储后会出现在这里。" />}</div></div>;
}

export function DiagnosticsPage({ snapshot, actions }: { snapshot: WorkbenchSnapshot; actions: PageActions }) {
  const failures = snapshot.diagnostics.filter((item) => item.status === "failed").length;
  const warnings = snapshot.diagnostics.filter((item) => item.status === "warning").length;
  const report = ["Workbench Windows 自检报告", `时间：${new Date(snapshot.refreshedAt).toLocaleString("zh-CN")}`, `工作区：${snapshot.workspacePath}`, "", ...snapshot.diagnostics.map((item) => `[${item.status}] ${item.title}：${item.detail}`)].join("\n");
  return <div className="page-scroll"><PageHeader eyebrow="TRUTH CHECK" title="系统自检" description="检查连接、工作区、扩展能力、存储与备份；可选功能缺失只算提醒。" actions={<button className="secondary-button" onClick={() => actions.run("diagnostics:copy", () => window.workbench.copyText(report))}><Clipboard size={15} />复制报告</button>} /><div className={`diagnostic-hero ${failures ? "has-failure" : warnings ? "has-warning" : "healthy"}`}><span>{failures ? <CircleAlert size={30} /> : <ShieldCheck size={30} />}</span><div><h2>{failures ? `${failures} 项需要处理` : warnings ? `基础功能正常，${warnings} 项提醒` : "Workbench 状态正常"}</h2><p>{failures ? "进入对应页面查看影响和可执行建议。" : "所有真实故障与可选缺失已经分开标记。"}</p></div></div><div className="diagnostic-list">{snapshot.diagnostics.map((record) => <button className="diagnostic-row card" key={record.id} onClick={() => record.destination && actions.navigate(record.destination)}><StatusIcon status={record.status} /><div><h3>{record.title}</h3><p>{record.detail}</p><small>{record.impact}</small></div><Badge tone={record.status === "passed" ? "good" : record.status === "warning" ? "warn" : record.status === "failed" ? "bad" : "neutral"}>{({ passed: "通过", warning: "提醒", failed: "失败", notChecked: "未检查", checking: "检查中" } as const)[record.status]}</Badge></button>)}</div></div>;
}

export function SettingsPage({ snapshot, actions }: { snapshot: WorkbenchSnapshot; actions: PageActions }) {
  const [draft, setDraft] = useState<WorkbenchSettings>(snapshot.settings);
  const [update, setUpdate] = useState<WorkbenchUpdateState | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  useEffect(() => setDraft(snapshot.settings), [snapshot.settings]);
  useEffect(() => {
    let disposed = false;
    void window.workbench.getUpdateState().then((state) => { if (!disposed) setUpdate(state); });
    const unsubscribe = window.workbench.onUpdateState((state) => { if (!disposed) setUpdate(state); });
    return () => { disposed = true; unsubscribe(); };
  }, []);
  function patch<K extends keyof WorkbenchSettings>(key: K, value: WorkbenchSettings[K]) { setDraft((current) => ({ ...current, [key]: value })); }
  async function handleUpdate(): Promise<void> {
    if (!update?.canCheck) return;
    setUpdateBusy(true);
    try {
      const next = await window.workbench.checkForUpdates();
      setUpdate(next);
      if (next.status === "error") actions.notify(next.message, "bad");
    } catch (error) {
      actions.notify(error instanceof Error ? error.message : "更新窗口未能打开。", "bad");
    } finally {
      setUpdateBusy(false);
    }
  }
  const distributionTitle = update?.distribution === "installed" ? "安装版" : update?.distribution === "portable" ? "便携版" : "开发版";
  const updateTone: Tone = update?.status === "error" ? "bad" : "neutral";
  return <div className="page-scroll settings-page">
    <PageHeader eyebrow="WINDOWS PREFERENCES" title="设置" description="管理本地路径、刷新节奏和窗口外观；登录凭据不由 Workbench 保存。" />
    <section className="settings-group card">
      <div><span className="settings-icon"><FolderOpen size={20} /></span><div><h2>工作区</h2><p>项目级 Skills、Hooks 和 MCP 以此目录解析。</p></div></div>
      <div className="settings-value"><code>{snapshot.workspacePath}</code><button className="secondary-button" onClick={actions.chooseWorkspace}>选择文件夹</button></div>
    </section>
    <section className="settings-group card">
      <div><span className="settings-icon"><TerminalSquare size={20} /></span><div><h2>Codex 可执行文件</h2><p>自动发现失败时手动选择 codex.exe。</p></div></div>
      <div className="settings-value"><code>{snapshot.codexExecutable ?? "尚未找到"}</code><button className="secondary-button" onClick={actions.chooseCodex}>选择 codex.exe</button></div>
    </section>
    <section className="settings-group card">
      <div><span className="settings-icon"><Settings2 size={20} /></span><div><h2>界面与刷新</h2><p>遵循 Windows 主题，并按设定周期更新账户用量。</p></div></div>
      <div className="settings-controls">
        <div className="setting-row"><span><strong>主题</strong><small>系统、浅色或深色</small></span><Segmented value={draft.theme} options={[{ value: "system", label: "跟随系统" }, { value: "light", label: "浅色" }, { value: "dark", label: "深色" }]} onChange={(value) => patch("theme", value)} /></div>
        <div className="setting-row"><span><strong>托盘图标</strong><small>关闭窗口时继续驻留</small></span><Toggle checked={draft.showTrayIcon} label="显示托盘图标" onChange={(value) => patch("showTrayIcon", value)} /></div>
        <div className="setting-row"><span><strong>用量刷新</strong><small>1 到 60 分钟</small></span><label className="number-field"><input type="number" min={1} max={60} value={draft.autoRefreshMinutes} onChange={(event) => patch("autoRefreshMinutes", Number(event.target.value))} />分钟</label></div>
      </div>
    </section>
    <div className="settings-save"><button className="primary-button" disabled={actions.busy === "settings:save"} onClick={() => actions.run("settings:save", () => window.workbench.saveSettings(draft))}>保存设置</button></div>
    <section className="settings-group card">
      <div><span className="settings-icon"><Download size={20} /></span><div><h2>软件更新</h2><p>打开更新窗口，授权访问 GitHub 私有发布频道。</p></div></div>
      <div className="update-value">
        <div className="update-copy">
          <div><strong>Workbench {update?.currentVersion ?? "—"}</strong><Badge tone={updateTone}>{distributionTitle}</Badge></div>
          <span>{update?.message ?? "正在读取更新状态…"}</span>
        </div>
        <button className="secondary-button" disabled={!update?.canCheck || updateBusy} onClick={handleUpdate}>
          {updateBusy ? <RefreshCw className="spin" size={15} /> : <Download size={15} />}检查更新
        </button>
      </div>
    </section>
    <section className="about-box"><img src="../../../docs/branding/workbench-icon-master.png" alt="" onError={(event) => { (event.currentTarget as HTMLImageElement).style.display = "none"; }} /><div><strong>Workbench for Windows</strong><p>基于原 macOS 开源项目重构。MIT License，与 OpenAI 无隶属或官方授权关系。</p><button className="link-button" onClick={() => actions.run("open:github", () => window.workbench.openExternal("https://github.com/42-0p6180339887/workbenchWin11"))}>查看 GitHub <ArrowUpRight size={13} /></button></div></section>
  </div>;
}

function skillTone(skill: SkillRecord): Tone { return skill.state === "available" ? "good" : skill.state === "disabled" ? "neutral" : "bad"; }
function skillStateTitle(skill: SkillRecord): string { return ({ available: "可用", disabled: "已隐藏", missingDependency: "缺少依赖", error: "配置错误" } as const)[skill.state]; }
function modeTitle(mode: SkillMode): string { return ({ implicit: "隐式", explicit: "显式", hidden: "隐藏" } as const)[mode]; }
function scopeTitle(scope: SkillRecord["scope"]): string { return ({ user: "个人", repo: "当前项目", system: "系统内置", admin: "管理员", unknown: "未知来源" } as const)[scope]; }
function hookTone(hook: HookRecord): Tone { return hook.runnableState === "ready" ? "good" : hook.runnableState === "disabled" ? "neutral" : hook.runnableState === "unsupportedHandler" ? "warn" : "bad"; }
function hookRunTitle(state: HookRecord["runnableState"]): string { return ({ ready: "可以运行", disabled: "已停用", needsTrust: "等待信任", changedSinceTrust: "需要重新信任", unsupportedHandler: "当前版本不运行" } as const)[state]; }
function memoryKindTitle(kind: MemoryRecord["kind"]): string { return ({ active: "当前生效", durable: "长期记忆", summary: "摘要", raw: "原始材料", other: "其他来源" } as const)[kind]; }
function mcpTone(server: MCPRecord): Tone { return server.effectiveState === "effective" ? "good" : server.effectiveState === "problem" ? "bad" : server.effectiveState === "disabled" ? "neutral" : "warn"; }
function mcpStateTitle(server: MCPRecord): string { return ({ effective: "已生效", problem: "有问题", disabled: "已停用", configured: "仅配置" } as const)[server.effectiveState]; }
