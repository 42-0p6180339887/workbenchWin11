import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Brain,
  CircleAlert,
  FolderOpen,
  Gauge,
  Github,
  HardDrive,
  History,
  LayoutDashboard,
  LoaderCircle,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  WandSparkles,
  Webhook,
} from "lucide-react";
import type { ActionResult, SectionName, WorkbenchSnapshot } from "../shared/types";
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

const navigation: Array<{ section: SectionName; label: string; icon: typeof LayoutDashboard }> = [
  { section: "dashboard", label: "总览", icon: LayoutDashboard },
  { section: "skills", label: "Skills", icon: WandSparkles },
  { section: "hooks", label: "Hooks", icon: Webhook },
  { section: "memory", label: "Memory", icon: Brain },
  { section: "usage", label: "用量", icon: Gauge },
  { section: "mcp", label: "MCP", icon: Server },
  { section: "storage", label: "存储", icon: HardDrive },
  { section: "backup", label: "备份", icon: Github },
  { section: "history", label: "变更记录", icon: History },
  { section: "diagnostics", label: "自检", icon: ShieldCheck },
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
  if (!snapshot) return <div className="boot-screen"><LoaderCircle className="spin" size={28} /><h1>Workbench</h1><p>正在读取 Codex 状态…</p></div>;

  const isRefreshing = busy?.startsWith("refresh:") || busy === "bootstrap";
  const canRescan = ["dashboard", "skills", "hooks"].includes(section);
  return <div className="app-shell">
    <div className="window-dragbar">
      <span className="window-title">Workbench</span>
      <div className="window-toolbar">
        <button className="titlebar-button" disabled={Boolean(busy)} onClick={chooseWorkspace}><FolderOpen size={15} /><span>切换工作区</span></button>
        {canRescan && <button className="titlebar-button" disabled={Boolean(busy)} onClick={() => refresh(section, section === "skills")}><span>{isRefreshing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}</span><span>重新扫描</span></button>}
      </div>
    </div>
    <aside className="sidebar">
      <nav>
        {navigation.map((item) => <NavButton key={item.section} item={item} active={section === item.section} onClick={() => setSection(item.section)} />)}
      </nav>
      <div className="sidebar-bottom">
        <button className={`nav-button ${section === "settings" ? "active" : ""}`} onClick={() => setSection("settings")}><Settings2 size={18} /><span>设置</span></button>
        <div className="workspace-footer" title={snapshot.workspacePath}><small>当前工作区</small><strong>{lastSegment(snapshot.workspacePath)}</strong><span>{snapshot.workspacePath}</span></div>
      </div>
    </aside>

    <main className="main-area">
      <div className="page-host">{renderPage(section, snapshot, actions)}</div>
    </main>
    {toast && <div className={`toast toast-${toast.tone}`}>{toast.tone === "good" ? <ShieldCheck size={17} /> : <CircleAlert size={17} />}<span>{toast.message}</span></div>}
  </div>;
}

function NavButton({ item, active, onClick }: { item: (typeof navigation)[number]; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick} title={item.label}><Icon size={17} /><span>{item.label}</span></button>;
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
