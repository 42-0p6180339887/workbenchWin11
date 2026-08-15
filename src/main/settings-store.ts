import { app } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { ChangeRecord, WorkbenchSettings } from "../shared/types";

interface StoreShape {
  settings: WorkbenchSettings;
  history: ChangeRecord[];
  lastBackupAt?: string;
}

function defaults(): StoreShape {
  return {
    settings: {
      workspacePath: os.homedir(),
      showTrayIcon: true,
      autoRefreshMinutes: 5,
      theme: "system",
    },
    history: [],
  };
}

export class SettingsStore {
  private data: StoreShape = defaults();
  private loaded = false;

  private get filePath(): string {
    return path.join(app.getPath("userData"), "workbench-settings.json");
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<StoreShape>;
      this.data = {
        ...defaults(),
        ...parsed,
        settings: { ...defaults().settings, ...(parsed.settings ?? {}) },
        history: Array.isArray(parsed.history) ? parsed.history.slice(0, 200) : [],
      };
    } catch {
      this.data = defaults();
    }
    if (!this.data.settings.workspacePath) this.data.settings.workspacePath = os.homedir();
  }

  get settings(): WorkbenchSettings {
    return { ...this.data.settings };
  }

  get history(): ChangeRecord[] {
    return [...this.data.history];
  }

  get lastBackupAt(): string | undefined {
    return this.data.lastBackupAt;
  }

  async updateSettings(patch: Partial<WorkbenchSettings>): Promise<void> {
    this.data.settings = { ...this.data.settings, ...patch };
    await this.persist();
  }

  async addHistory(record: Omit<ChangeRecord, "id" | "at">): Promise<void> {
    this.data.history.unshift({ ...record, id: crypto.randomUUID(), at: new Date().toISOString() });
    this.data.history = this.data.history.slice(0, 200);
    await this.persist();
  }

  async markBackup(): Promise<void> {
    this.data.lastBackupAt = new Date().toISOString();
    await this.persist();
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify(this.data, null, 2), "utf8");
    await rename(temporary, this.filePath);
  }
}
