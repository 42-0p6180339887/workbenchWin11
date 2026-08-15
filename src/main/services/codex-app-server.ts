import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import { sanitize } from "../security";

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface CodexServerInfo {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOS: string;
}

export class CodexAppServer extends EventEmitter {
  private process?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private info?: CodexServerInfo;

  get connected(): boolean {
    return Boolean(this.process && this.info && this.process.exitCode === null);
  }

  get serverInfo(): CodexServerInfo | undefined {
    return this.info;
  }

  async connect(executable: string, clientVersion: string): Promise<CodexServerInfo> {
    if (this.connected && this.info) return this.info;
    await this.disconnect();

    const child = spawn(executable, ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });
    this.process = child;
    child.once("exit", (code) => this.finish(new Error(`Codex App Server 已退出（${code ?? "未知状态"}）。`)));
    child.once("error", (error) => this.finish(error));
    child.stderr.on("data", () => undefined);

    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.receive(line));
    lines.once("close", () => {
      if (this.process === child && child.exitCode === null) this.finish(new Error("Codex App Server 输出已关闭。"));
    });

    const result = await this.request<Record<string, unknown>>("initialize", {
      clientInfo: { name: "workbench_windows", title: "Workbench", version: clientVersion },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    this.notify("initialized", {});
    this.info = {
      userAgent: String(result.userAgent ?? "Codex"),
      codexHome: String(result.codexHome ?? ""),
      platformFamily: String(result.platformFamily ?? "windows"),
      platformOS: String(result.platformOs ?? result.platformOS ?? "windows"),
    };
    if (!this.info.codexHome) throw new Error("Codex 未返回配置目录。");
    return this.info;
  }

  async disconnect(): Promise<void> {
    const child = this.process;
    this.process = undefined;
    this.info = undefined;
    this.rejectPending(new Error("Codex 连接已关闭。"));
    if (child && child.exitCode === null) {
      child.removeAllListeners("exit");
      child.kill();
    }
  }

  request<T>(method: string, params: unknown = {}): Promise<T> {
    const child = this.process;
    if (!child || child.exitCode !== null) return Promise.reject(new Error("Codex App Server 尚未连接。"));
    const id = this.nextId++;
    const timeout = timeoutFor(method);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 在 ${Math.round(timeout / 1000)} 秒内没有响应。`));
      }, timeout);
      this.pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject, timer });
      child.stdin.write(`${JSON.stringify({ method, id, params })}\n`, "utf8", (error) => {
        if (!error) return;
        const entry = this.pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  notify(method: string, params?: unknown): void {
    const child = this.process;
    if (!child || child.exitCode !== null) throw new Error("Codex App Server 尚未连接。");
    child.stdin.write(`${JSON.stringify({ method, params })}\n`, "utf8");
  }

  private receive(line: string): void {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line) as {
        id?: number;
        method?: string;
        result?: unknown;
        params?: unknown;
        error?: { code?: number; message?: string };
      };
      if (typeof message.id === "number") {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(message.id);
        if (message.error) {
          entry.reject(new Error(`${entry.method} 失败：${sanitize(message.error.message ?? message.error.code ?? "未知错误")}`));
        } else if ("result" in message) {
          entry.resolve(message.result);
        } else {
          entry.reject(new Error(`${entry.method} 返回了无效响应。`));
        }
        return;
      }
      if (message.method) this.emit("event", { method: message.method, params: message.params });
    } catch {
      this.emit("event", { method: "client/malformedMessage" });
    }
  }

  private finish(error: Error): void {
    if (!this.process) return;
    this.process = undefined;
    this.info = undefined;
    this.rejectPending(error);
    this.emit("exit", error);
  }

  private rejectPending(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
}

function timeoutFor(method: string): number {
  if (method === "initialize") return 20_000;
  if (["skills/list", "hooks/list"].includes(method)) return 30_000;
  if (method === "mcpServerStatus/list") return 45_000;
  if (method.startsWith("config/") || method.startsWith("account/")) return 20_000;
  return 15_000;
}
