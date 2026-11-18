import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { WorkbenchUpdateState } from "../shared/types";
import { resolveUpdateDistribution } from "../shared/updates";

export class WorkbenchUpdateService {
  private state: WorkbenchUpdateState;
  private window?: ChildProcess;

  constructor(private readonly emit: (state: WorkbenchUpdateState) => void) {
    const distribution = resolveUpdateDistribution(app.isPackaged, process.env.PORTABLE_EXECUTABLE_FILE);
    const canCheck = distribution !== "development" && process.platform === "win32";
    this.state = {
      status: canCheck ? "idle" : "unsupported",
      distribution,
      currentVersion: app.getVersion(),
      message: canCheck ? "从 GitHub 私有发布频道下载并校验更新。" : "开发版不连接正式更新通道。",
      canCheck,
    };
  }

  get snapshot(): WorkbenchUpdateState {
    return { ...this.state };
  }

  async checkForUpdates(): Promise<WorkbenchUpdateState> {
    if (!this.state.canCheck || (this.window && this.window.exitCode === null)) return this.snapshot;
    const directory = path.join(process.resourcesPath, "private-updates");
    const script = path.join(directory, "AppUpdates.ps1");
    const config = path.join(directory, "app-update.json");
    if (!existsSync(script) || !existsSync(config)) return this.fail("更新组件缺失，请重新安装此版本。");
    const windows = process.env.SystemRoot || "C:\\Windows";
    const executable = path.join(windows, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    try {
      const child = spawn(executable, [
        "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", script, "-Config", config,
      ], { windowsHide: true, detached: true, stdio: "ignore" });
      this.window = child;
      child.once("exit", (code) => {
        if (this.window === child) this.window = undefined;
        if (code !== 0) this.fail("更新窗口意外关闭，请重新打开。");
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", () => { child.unref(); resolve(); });
        child.once("error", reject);
      });
      this.state = { ...this.state, status: "idle", message: "更新窗口已打开。" };
      this.emit(this.snapshot);
      return this.snapshot;
    } catch {
      this.window = undefined;
      return this.fail("无法启动更新窗口，请检查 Windows PowerShell。");
    }
  }

  private fail(message: string): WorkbenchUpdateState {
    this.state = { ...this.state, status: "error", message };
    this.emit(this.snapshot);
    return this.snapshot;
  }
}
