import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArchiveRestore,
  Brain,
  ChevronDown,
  CircleAlert,
  FolderOpen,
  Gauge,
  Github,
  HardDrive,
  History,
  LayoutDashboard,
  LoaderCircle,
  PanelLeft,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  WandSparkles,
  Webhook,
} from "lucide-react";
import type { ActionResult, SectionName, WorkbenchSnapshot } from "../shared/types";
import { Badge, formatDate } from "./components/ui";
import {
  BackupPage,
  DashboardPage,
  DiagnosticsPage,
  HistoryPage,
  HooksPage,
  MCPPage,
  MemoryPage,
  type PageActions,
  SettingsPage,
  SkillsPage,
  StoragePage,
  UsagePage,
} from "./pages/Pages";

const navigation: Array<{ section: SectionName; label: string; icon: typeof LayoutDashboard; group?: "system" }> = [
  { section: "dashboard", label: "总览", icon: LayoutDashboard },
  { section: "skills", label: "Skills", icon: WandSparkles },
  { section: "hooks", label: "Hooks", icon: Webhook },
  { section: "memory", label: "Memory", icon: Brain },
  { section: "usage", label: "账户用量", icon: Gauge },
  { section: "mcp", label: "MCP", icon: Server },
  { section: "storage", label: "本机存储", icon: HardDrive, group: "system" },
  { section: "backup", label: "GitHub 备份", icon: Github, group: "system" },
  { section: "history", label: "变更记录", icon: History, group: "system" },
  { section: "diagnostics", label: "系统自检", icon: ShieldCheck, group: "system" },
];

export function App() {
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(null);
  const [section, setSection] = useState<SectionName>(() => {
    const requested = new URLSearchParams(location.search).get("section") as SectionName | null;
    return requested && [...navigation.map((item) => item.section), "settings"].includes(requested) ? requested : "dashboard";
  });
  const [busy, setBusy] = useState<string | null>("bootstrap");
  const [fatalError, setFatalError] = useState<string>();
  const [toast, setToast] = useState<{ message: string; tone: "good" | "bad" }>();
  const [compactNav, setCompactNav] = useState(false);

  useEffect(() => {
    const unsubscribe = window.workbench.onSnapshot(setSnapshot);
    window.workbench.bootstrap().then(setSnapshot).catch((error) => setFatalError(error instanceof Error ? error.message : "Workbench 启动失败。" )).finally(() => setBusy(null));
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    document.documentElement.dataset.theme = snapshot.settings.theme;
  }, [snapshot?.settings.theme]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), 3_600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const notify = useCallback((message: string, tone: "good" | "bad" = "good") => setToast({ message, tone }), []);

  const run = useCallback(async (key: string, task: () => Promise<ActionResult>) => {
    try {
      setBusy(key);
      const result = await task();
      if (result.snapshot) setSnapshot(result.snapshot);
      notify(result.message, result.ok ? "good" : "bad");
    } catch (error) {
      notify(error instanceof Error ? error.message : "操作没有完成。", "bad");
    } finally {
      setBusy(null);
    }
  }, [notify]);

  const refresh = useCallback(async (target?: SectionName, force = false) => {
    try {
      setBusy(`refresh:${target ?? "all"}`);
      setSnapshot(await window.workbench.refresh(target, force));
      notify("状态已更新。");
    } catch (error) {
      notify(error instanceof Error ? error.message : "刷新失败。", "bad");
    } finally {
      setBusy(null);
    }
  }, [notify]);

  const chooseWorkspace = useCallback(async () => {
    try {
      setBusy("workspace");
      const next = await window.workbench.chooseWorkspace();
      if (next) { setSnapshot(next); notify("工作区已切换。"); }
    } catch (error) { notify(error instanceof Error ? error.message : "无法切换工作区。", "bad"); }
    finally { setBusy(null); }
  }, [notify]);

  const chooseCodex = useCallback(async () => {
    try {
      setBusy("codex");
      const next = await window.workbench.chooseCodexExecutable();
      if (next) { setSnapshot(next); notify("Codex 可执行文件已更新。"); }
    } catch (error) { notify(error instanceof Error ? error.message : "无法选择 Codex。", "bad"); }
    finally { setBusy(null); }
  }, [notify]);

  const actions: PageActions = useMemo(() => ({ busy, run, refresh, chooseWorkspace, chooseCodex, navigate: setSection, notify }), [busy, run, refresh, chooseWorkspace, chooseCodex, notify]);

  if (fatalError) return <div className="fatal-screen"><CircleAlert size={38} /><h1>Workbench 无法启动</h1><p>{fatalError}</p><button className="primary-button" onClick={() => location.reload()}>重新载入</button></div>;
  if (!snapshot) return <div className="boot-screen"><div className="boot-mark"><Activity size={34} /></div><h1>Workbench</h1><p>正在连接 Codex 并建立本地状态图…</p><div className="boot-line"><span /></div></div>;

  const isRefreshing = busy?.startsWith("refresh:") || busy === "bootstrap";
  return <div className={`app-shell ${compactNav ? "compact-nav" : ""}`}>
    <div className="window-dragbar"><span>Workbench</span></div>
    <aside className="sidebar">
      <div className="brand-row"><div className="brand-mark"><Activity size={21} /></div><div className="brand-copy"><strong>Workbench</strong><small>for Windows</small></div><button className="nav-collapse" onClick={() => setCompactNav((value) => !value)} title="折叠导航"><PanelLeft size={17} /></button></div>
      <nav>
        <div className="nav-label">工作台</div>
        {navigation.filter((item) => !item.group).map((item) => <NavButton key={item.section} item={item} active={section === item.section} onClick={() => setSection(item.section)} />)}
        <div className="nav-label nav-system">系统与安全</div>
        {navigation.filter((item) => item.group).map((item) => <NavButton key={item.section} item={item} active={section === item.section} onClick={() => setSection(item.section)} />)}
      </nav>
      <div className="sidebar-bottom">
        <button className={`nav-button ${section === "settings" ? "active" : ""}`} onClick={() => setSection("settings")}><Settings2 size={18} /><span>设置</span></button>
        <button className="workspace-chip" onClick={chooseWorkspace} title={snapshot.workspacePath}><FolderOpen size={16} /><span><small>当前工作区</small><strong>{lastSegment(snapshot.workspacePath)}</strong></span><ChevronDown size={14} /></button>
      </div>
    </aside>

    <main className="main-area">
      <header className="signal-rail">
        <div className="signal-node connection-node"><span className={`connection-light ${snapshot.connection.status}`} /> <div><small>CODEX</small><strong>{snapshot.connection.label}</strong></div></div>
        <div className="signal-line" />
        <button className="signal-node" onClick={chooseWorkspace}><FolderOpen size={16} /><div><small>WORKSPACE</small><strong>{lastSegment(snapshot.workspacePath)}</strong></div></button>
        <div className="signal-line" />
        <button className="signal-node signal-home" onClick={() => run("open:home", () => window.workbench.openPath(snapshot.codexHome))}><ArchiveRestore size={16} /><div><small>CODEX HOME</small><strong>{snapshot.codexHome}</strong></div></button>
        <button className="refresh-button" disabled={Boolean(busy)} onClick={() => refresh(section, section === "skills")} title="刷新当前页面">{isRefreshing ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}<span>刷新</span></button>
      </header>
      <div className="page-host">{renderPage(section, snapshot, actions)}</div>
      <footer className="status-footer"><span><i className={`footer-dot ${snapshot.connection.status}`} />{snapshot.connection.userAgent ?? "Codex App Server"}</span><span>上次更新 {formatDate(snapshot.refreshedAt)}</span></footer>
    </main>
    {toast && <div className={`toast toast-${toast.tone}`}>{toast.tone === "good" ? <ShieldCheck size={17} /> : <CircleAlert size={17} />}<span>{toast.message}</span></div>}
  </div>;
}

function NavButton({ item, active, onClick }: { item: (typeof navigation)[number]; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick} title={item.label}><Icon size={18} /><span>{item.label}</span></button>;
}

function renderPage(section: SectionName, snapshot: WorkbenchSnapshot, actions: PageActions) {
  switch (section) {
    case "dashboard": return <DashboardPage snapshot={snapshot} actions={actions} />;
    case "skills": return <SkillsPage snapshot={snapshot} actions={actions} />;
    case "hooks": return <HooksPage snapshot={snapshot} actions={actions} />;
    case "memory": return <MemoryPage snapshot={snapshot} actions={actions} />;
    case "usage": return <UsagePage snapshot={snapshot} actions={actions} />;
    case "mcp": return <MCPPage snapshot={snapshot} actions={actions} />;
    case "storage": return <StoragePage snapshot={snapshot} actions={actions} />;
    case "backup": return <BackupPage snapshot={snapshot} actions={actions} />;
    case "history": return <HistoryPage snapshot={snapshot} actions={actions} />;
    case "diagnostics": return <DiagnosticsPage snapshot={snapshot} actions={actions} />;
    case "settings": return <SettingsPage snapshot={snapshot} actions={actions} />;
  }
}

function lastSegment(value: string): string {
  const parts = value.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts.at(-1) || value;
}
