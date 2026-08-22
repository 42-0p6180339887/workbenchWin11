import { app } from "electron";
import * as electronUpdater from "electron-updater";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import type { WorkbenchUpdateState } from "../shared/types";
import { resolveUpdateDistribution } from "../shared/updates";

const RELEASE_URL = "https://github.com/42-0p6180339887/workbenchWin11/releases/latest";

export class WorkbenchUpdateService {
  private state: WorkbenchUpdateState;

  constructor(private readonly emit: (state: WorkbenchUpdateState) => void) {
    const distribution = resolveUpdateDistribution(app.isPackaged, process.env.PORTABLE_EXECUTABLE_FILE);
    this.state = {
      status: distribution === "installed" ? "idle" : "unsupported",
      distribution,
      currentVersion: app.getVersion(),
      message: distribution === "installed"
        ? "可从 GitHub Releases 检查并安装新版本。"
        : distribution === "portable"
          ? "便携版不能原地升级，请从发布页下载新版本。"
          : "开发模式不连接正式更新通道。",
      releaseUrl: RELEASE_URL,
      canCheck: distribution === "installed",
      canDownload: false,
      canInstall: false,
    };

    if (distribution === "installed") this.configureUpdater();
  }

  get snapshot(): WorkbenchUpdateState {
    return structuredClone(this.state);
  }

  async checkForUpdates(): Promise<WorkbenchUpdateState> {
    if (!this.state.canCheck || this.state.status === "checking" || this.state.status === "downloading") return this.snapshot;
    this.setState({
      status: "checking",
      message: "正在检查 GitHub Releases…",
      progressPercent: undefined,
      transferredBytes: undefined,
      totalBytes: undefined,
      canCheck: false,
      canDownload: false,
      canInstall: false,
    });
    try {
      await electronUpdater.autoUpdater.checkForUpdates();
    } catch (error) {
      this.fail(error);
    }
    return this.snapshot;
  }

  async downloadUpdate(): Promise<WorkbenchUpdateState> {
    if (this.state.status !== "available" || !this.state.canDownload) return this.snapshot;
    this.setState({
      status: "downloading",
      message: `正在下载 Workbench ${this.state.availableVersion ?? "新版本"}…`,
      progressPercent: 0,
      transferredBytes: 0,
      canCheck: false,
      canDownload: false,
      canInstall: false,
    });
    try {
      await electronUpdater.autoUpdater.downloadUpdate();
    } catch (error) {
      this.fail(error);
    }
    return this.snapshot;
  }

  installUpdate(): WorkbenchUpdateState {
    if (this.state.status !== "downloaded" || !this.state.canInstall) return this.snapshot;
    this.setState({
      status: "installing",
      message: "正在退出并安装更新…",
      canCheck: false,
      canDownload: false,
      canInstall: false,
    });
    try {
      electronUpdater.autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      this.fail(error);
    }
    return this.snapshot;
  }

  private configureUpdater(): void {
    const { autoUpdater } = electronUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.disableWebInstaller = true;

    autoUpdater.on("checking-for-update", () => this.setState({
      status: "checking",
      message: "正在检查 GitHub Releases…",
      canCheck: false,
      canDownload: false,
      canInstall: false,
    }));
    autoUpdater.on("update-available", (info: UpdateInfo) => this.setState({
      status: "available",
      availableVersion: info.version,
      releaseDate: info.releaseDate,
      message: `发现 Workbench ${info.version}，可以下载更新。`,
      canCheck: true,
      canDownload: true,
      canInstall: false,
    }));
    autoUpdater.on("update-not-available", () => this.setState({
      status: "notAvailable",
      availableVersion: undefined,
      releaseDate: undefined,
      message: `Workbench ${this.state.currentVersion} 已是最新版本。`,
      canCheck: true,
      canDownload: false,
      canInstall: false,
    }));
    autoUpdater.on("download-progress", (progress: ProgressInfo) => this.setState({
      status: "downloading",
      progressPercent: Math.max(0, Math.min(100, progress.percent)),
      transferredBytes: progress.transferred,
      totalBytes: progress.total,
      message: `正在下载 Workbench ${this.state.availableVersion ?? "新版本"}…`,
      canCheck: false,
      canDownload: false,
      canInstall: false,
    }));
    autoUpdater.on("update-downloaded", (info: UpdateInfo) => this.setState({
      status: "downloaded",
      availableVersion: info.version,
      releaseDate: info.releaseDate,
      progressPercent: 100,
      message: `Workbench ${info.version} 已下载，退出应用即可安装。`,
      canCheck: false,
      canDownload: false,
      canInstall: true,
    }));
    autoUpdater.on("error", (error: Error) => this.fail(error));
  }

  private fail(error: unknown): void {
    const detail = error instanceof Error ? error.message : "未知更新错误";
    this.setState({
      status: "error",
      message: `更新没有完成：${detail.slice(0, 240)}`,
      canCheck: true,
      canDownload: false,
      canInstall: false,
    });
  }

  private setState(patch: Partial<WorkbenchUpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.emit(this.snapshot);
  }
}
