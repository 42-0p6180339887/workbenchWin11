import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, shell, Tray } from "electron";
import path from "node:path";
import { lstat, writeFile } from "node:fs/promises";
import type { ActionResult, SectionName, SkillMode, StorageKind, WorkbenchSettings, WorkbenchUpdateState } from "../shared/types";
import { isInside } from "./security";
import { WorkbenchUpdateService } from "./update-service";
import { WorkbenchController } from "./workbench-controller";

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let refreshTimer: NodeJS.Timeout | undefined;
let lastAutomaticRefresh = 0;
let quitting = false;
let updateService: WorkbenchUpdateService | undefined;

process.env.WORKBENCH_BUNDLED_CODEX = app.isPackaged
  ? path.join(process.resourcesPath, "codex", "bin", "codex.exe")
  : path.join(app.getAppPath(), "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");

const controller = new WorkbenchController((target) => shell.trashItem(target));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());
}

app.whenReady().then(async () => {
  createWindow();
  updateService = new WorkbenchUpdateService((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("workbench:updateState", state);
  });
  installApplicationMenu();
  registerIpc();
  startRefreshTimer();
});

app.on("activate", () => showMainWindow());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !tray) app.quit();
});
app.on("before-quit", () => {
  quitting = true;
  if (refreshTimer) clearInterval(refreshTimer);
  void controller.shutdown();
});

function createWindow(): void {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "workbench-icon.png")
    : path.join(app.getAppPath(), "docs", "branding", "workbench-icon-master.png");
  mainWindow = new BrowserWindow({
    title: "Workbench",
    width: 1240,
    height: 800,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: "#eef1f2",
    icon: iconPath,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#e6eaec", symbolColor: "#202428", height: 38 },
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  controller.attach(mainWindow.webContents);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (event) => {
    if (!quitting && tray && controller.snapshot.settings.showTrayIcon) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow?.webContents.getURL();
    if (url !== current) event.preventDefault();
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"), {
    query: process.env.WORKBENCH_SMOKE_SECTION ? { section: process.env.WORKBENCH_SMOKE_SECTION } : undefined,
  });
}

function showMainWindow(): void {
  if (!mainWindow) createWindow();
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
}

function updateTray(): void {
  const settings = controller.snapshot.settings;
  nativeTheme.themeSource = settings.theme;
  const dark = settings.theme === "dark" || (settings.theme === "system" && nativeTheme.shouldUseDarkColors);
  mainWindow?.setTitleBarOverlay({
    color: dark ? "#202224" : "#e6eaec",
    symbolColor: dark ? "#f1f1f2" : "#202428",
    height: 38,
  });
  mainWindow?.setBackgroundColor(dark ? "#1b1d1e" : "#eef1f2");
  if (!settings.showTrayIcon) {
    tray?.destroy();
    tray = undefined;
    return;
  }
  if (tray) return;
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "workbench-icon.png")
    : path.join(app.getAppPath(), "docs", "branding", "workbench-icon-master.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 });
  tray = new Tray(icon);
  tray.setToolTip("Workbench · Codex 状态");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开 Workbench", click: showMainWindow },
    { label: "刷新全部状态", click: () => void controller.refresh() },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]));
  tray.on("click", showMainWindow);
}

function installApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "Workbench",
      submenu: [
        { label: "刷新全部状态", accelerator: "F5", click: () => void controller.refresh() },
        {
          label: "检查更新…",
          enabled: updateService?.snapshot.distribution === "installed",
          click: () => {
            showMainWindow();
            void updateService?.checkForUpdates();
          },
        },
        { type: "separator" },
        { role: "quit", label: "退出" },
      ],
    },
    { label: "编辑", submenu: [{ role: "copy", label: "复制" }, { role: "selectAll", label: "全选" }] },
    { label: "视图", submenu: [{ role: "reload", label: "重新载入窗口" }, { role: "toggleDevTools", label: "开发者工具" }] },
  ]));
}

function registerIpc(): void {
  ipcMain.handle("workbench:bootstrap", () => controller.bootstrap().then(async (snapshot) => {
    updateTray();
    if (process.env.WORKBENCH_SMOKE_SCREENSHOT && mainWindow) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      const image = await mainWindow.webContents.capturePage();
      await writeFile(path.resolve(process.env.WORKBENCH_SMOKE_SCREENSHOT), image.toPNG());
      setTimeout(() => app.quit(), 150);
    }
    return snapshot;
  }));
  ipcMain.handle("workbench:refresh", (_event, section?: SectionName, forceReload?: boolean) => controller.refresh(section, forceReload));
  ipcMain.handle("workbench:chooseWorkspace", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { title: "选择 Codex 工作区", properties: ["openDirectory"] });
    return result.canceled || !result.filePaths[0] ? null : controller.setWorkspace(result.filePaths[0]);
  });
  ipcMain.handle("workbench:chooseCodex", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { title: "选择 codex.exe", properties: ["openFile"], filters: [{ name: "Codex", extensions: ["exe"] }] });
    return result.canceled || !result.filePaths[0] ? null : controller.setCodexExecutable(result.filePaths[0]);
  });
  ipcMain.handle("workbench:setSkillMode", (_event, id: string, mode: SkillMode) => action(() => controller.setSkillMode(String(id), mode)));
  ipcMain.handle("workbench:setHookEnabled", (_event, id: string, enabled: boolean) => action(() => controller.setHookEnabled(String(id), Boolean(enabled))));
  ipcMain.handle("workbench:setMCPEnabled", (_event, name: string, enabled: boolean) => action(() => controller.setMCPEnabled(String(name), Boolean(enabled))));
  ipcMain.handle("workbench:reloadMCP", () => action(() => controller.reloadMCP()));
  ipcMain.handle("workbench:cleanupStorage", (_event, kind: StorageKind, fingerprint: string) => action(() => controller.cleanupStorage(kind, String(fingerprint))));
  ipcMain.handle("workbench:saveSettings", (_event, patch: Partial<WorkbenchSettings>) => action(async () => {
    const result = await controller.saveSettings(patch ?? {});
    updateTray();
    return result;
  }));
  ipcMain.handle("workbench:openPath", (_event, target: string) => action(async () => {
    const snapshot = controller.snapshot;
    const resolved = path.resolve(String(target));
    const roots = [snapshot.codexHome, snapshot.workspacePath, path.dirname(snapshot.codexExecutable ?? snapshot.codexHome)];
    if (!roots.some((root) => isInside(resolved, root))) throw new Error("只能打开当前工作区或 Codex 目录中的路径。");
    await lstat(resolved);
    const error = await shell.openPath(resolved);
    if (error) throw new Error(error);
    return { ok: true, message: "已在资源管理器中打开。" };
  }));
  ipcMain.handle("workbench:openExternal", (_event, url: string) => action(async () => {
    const parsed = new URL(String(url));
    if (parsed.protocol !== "https:") throw new Error("只允许打开 HTTPS 链接。");
    await shell.openExternal(parsed.toString());
    return { ok: true, message: "已在浏览器中打开。" };
  }));
  ipcMain.handle("workbench:copyText", (_event, value: string) => action(async () => {
    const text = String(value).slice(0, 100_000);
    clipboard.writeText(text);
    return { ok: true, message: "已复制。" };
  }));
  ipcMain.handle("workbench:previewBackup", (_event, repository: string) => controller.previewBackup(String(repository)));
  ipcMain.handle("workbench:runBackup", (_event, repository: string) => action(() => controller.runBackup(String(repository))));
  ipcMain.handle("workbench:getUpdateState", () => currentUpdateState());
  ipcMain.handle("workbench:checkForUpdates", () => updateService?.checkForUpdates() ?? currentUpdateState());
  ipcMain.handle("workbench:downloadUpdate", () => updateService?.downloadUpdate() ?? currentUpdateState());
  ipcMain.handle("workbench:installUpdate", () => {
    const readyToInstall = updateService?.snapshot.canInstall === true;
    if (readyToInstall) quitting = true;
    const state = updateService?.installUpdate() ?? currentUpdateState();
    if (state.status === "error") quitting = false;
    return state;
  });
}

function currentUpdateState(): WorkbenchUpdateState {
  return updateService?.snapshot ?? {
    status: "unsupported",
    distribution: "development",
    currentVersion: app.getVersion(),
    message: "更新服务尚未就绪。",
    releaseUrl: "https://github.com/42-0p6180339887/workbenchWin11/releases/latest",
    canCheck: false,
    canDownload: false,
    canInstall: false,
  };
}

async function action(task: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await task();
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "操作没有完成。" };
  }
}

function startRefreshTimer(): void {
  refreshTimer = setInterval(() => {
    const minutes = controller.snapshot.settings.autoRefreshMinutes;
    if (Date.now() - lastAutomaticRefresh < minutes * 60_000) return;
    lastAutomaticRefresh = Date.now();
    void controller.refresh("usage");
  }, 60_000);
}
