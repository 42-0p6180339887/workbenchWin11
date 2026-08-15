import { createHash, randomUUID } from "node:crypto";
import { mkdir, lstat, readdir, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { StorageKind, StorageRecord } from "../../shared/types";
import { isInside } from "../security";

interface Candidate {
  path: string;
  sizeBytes: number;
  modifiedMs: number;
}

interface Measurement {
  sizeBytes: number;
  itemCount: number;
  candidates: Candidate[];
  truncated: boolean;
}

const definitions: Record<StorageKind, { title: string; component?: string; level: StorageRecord["cleanupLevel"]; impact: string }> = {
  sessions: { title: "会话记录", component: "sessions", level: "protected", impact: "当前与历史任务记录保持只读，避免丢失对话。" },
  archivedSessions: { title: "已归档会话", component: "archived_sessions", level: "cautious", impact: "历史会话仅在单独确认后移入 Windows 回收站。" },
  plugins: { title: "插件", component: "plugins", level: "protected", impact: "已安装能力不属于缓存，应通过插件管理功能处理。" },
  skills: { title: "Skills", component: "skills", level: "protected", impact: "Skill 定义保持只读，应通过 Skills 页面管理。" },
  packages: { title: "软件包", component: "packages", level: "protected", impact: "依赖软件包保持只读。" },
  cache: { title: "缓存", component: "cache", level: "safe", impact: "移除可重新生成的缓存，并立即重建空目录。" },
  temporary: { title: "临时数据", component: ".tmp", level: "safe", impact: "只处理超过 24 小时的普通临时文件。" },
  logs: { title: "诊断日志", component: "log", level: "safe", impact: "只处理超过 7 天的普通日志文件。" },
  database: { title: "状态数据库", level: "protected", impact: "Codex 状态数据库禁止自动清理。" },
  other: { title: "其他数据", level: "protected", impact: "未知用途的数据保持只读。" },
};

export class StorageService {
  constructor(private readonly trashItem: (target: string) => Promise<void>) {}

  async scan(codexHome: string): Promise<StorageRecord[]> {
    const home = await realpath(codexHome);
    const homeStat = await lstat(home);
    if (!homeStat.isDirectory() || homeStat.isSymbolicLink()) throw new Error("Codex Home 不是可安全扫描的目录。");
    const children = await readdir(home, { withFileTypes: true });
    const records: StorageRecord[] = [];
    let otherSize = 0;
    let otherCount = 0;

    for (const child of children) {
      const childPath = path.join(home, child.name);
      const kind = classify(child.name);
      const measurement = await measure(childPath);
      if (kind === "other") {
        otherSize += measurement.sizeBytes;
        otherCount += measurement.itemCount;
        continue;
      }
      records.push(toRecord(kind, childPath, measurement));
    }
    if (otherSize || otherCount) {
      records.push({
        id: path.join(home, "其他数据（合并显示）"),
        kind: "other",
        title: definitions.other.title,
        path: path.join(home, "其他数据（合并显示）"),
        sizeBytes: otherSize,
        itemCount: otherCount,
        reclaimableSizeBytes: 0,
        reclaimableItemCount: 0,
        cleanupLevel: "protected",
        cleanupImpact: definitions.other.impact,
      });
    }
    return records.sort((a, b) => b.sizeBytes - a.sizeBytes || a.path.localeCompare(b.path));
  }

  async cleanup(codexHome: string, kind: StorageKind, expectedFingerprint: string): Promise<{ bytes: number; items: number; disposition: string }> {
    const definition = definitions[kind];
    if (!definition.component || definition.level === "protected") throw new Error("这类数据受到保护，不能由 Workbench 清理。");
    const home = await realpath(codexHome);
    const targetSupplied = path.resolve(home, definition.component);
    if (path.dirname(targetSupplied).toLowerCase() !== home.toLowerCase()) throw new Error("清理目标不在 Codex Home 的固定白名单内。");
    const targetStat = await lstat(targetSupplied);
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) throw new Error("清理目标不是安全的普通目录。");
    const target = await realpath(targetSupplied);
    if (!isInside(target, home) || path.basename(target).toLowerCase() !== definition.component.toLowerCase()) throw new Error("清理目标超出 Codex Home。");

    const measurement = await measure(target);
    const record = toRecord(kind, target, measurement);
    if (!record.cleanupFingerprint || record.cleanupFingerprint !== expectedFingerprint) throw new Error("内容在扫描后发生了变化，请重新扫描再确认。");
    if (!record.reclaimableItemCount) throw new Error("当前没有符合规则的可清理文件。");

    if (kind === "cache" || kind === "archivedSessions") {
      await this.replaceWholeDirectory(home, target, kind);
    } else {
      const candidates = cleanupCandidates(kind, measurement.candidates);
      await this.moveSelectedFiles(home, target, kind, candidates);
    }
    return { bytes: record.reclaimableSizeBytes, items: record.reclaimableItemCount, disposition: "已移入 Windows 回收站" };
  }

  private async replaceWholeDirectory(home: string, target: string, kind: StorageKind): Promise<void> {
    const staging = path.join(home, `.workbench-${kind}-${randomUUID()}`);
    let moved = false;
    try {
      await rename(target, staging);
      moved = true;
      await mkdir(target);
      await this.trashItem(staging);
      moved = false;
    } catch (error) {
      if (moved) {
        try {
          await rm(target, { recursive: true, force: false });
          await rename(staging, target);
          moved = false;
        } catch {
          throw new Error(`清理没有完成，数据保留在 ${staging}，请停止继续清理。`);
        }
      }
      throw error;
    }
  }

  private async moveSelectedFiles(home: string, target: string, kind: StorageKind, candidates: Candidate[]): Promise<void> {
    const staging = path.join(home, `.workbench-${kind}-${randomUUID()}`);
    await mkdir(staging);
    const moved: Array<{ source: string; staged: string }> = [];
    try {
      for (const candidate of candidates) {
        const current = await lstat(candidate.path);
        if (!current.isFile() || current.isSymbolicLink() || current.size !== candidate.sizeBytes || Math.round(current.mtimeMs) !== candidate.modifiedMs) {
          throw new Error("文件在扫描后发生了变化。");
        }
        const relative = path.relative(target, candidate.path);
        if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("发现超出清理目录的文件。");
        const staged = path.join(staging, relative);
        await mkdir(path.dirname(staged), { recursive: true });
        await rename(candidate.path, staged);
        moved.push({ source: candidate.path, staged });
      }
      await this.trashItem(staging);
    } catch (error) {
      try {
        for (const item of moved.reverse()) {
          await mkdir(path.dirname(item.source), { recursive: true });
          await rename(item.staged, item.source);
        }
        await rm(staging, { recursive: true, force: true });
      } catch {
        throw new Error(`清理没有完成，部分数据保留在 ${staging}，请停止继续清理。`);
      }
      throw error;
    }
  }
}

async function measure(root: string): Promise<Measurement> {
  const candidates: Candidate[] = [];
  let sizeBytes = 0;
  let itemCount = 0;
  let scanned = 0;
  let truncated = false;

  async function visit(current: string): Promise<void> {
    if (scanned >= 150_000) {
      truncated = true;
      return;
    }
    scanned += 1;
    let stat;
    try {
      stat = await lstat(current);
    } catch {
      return;
    }
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      const candidate = { path: current, sizeBytes: stat.size, modifiedMs: Math.round(stat.mtimeMs) };
      candidates.push(candidate);
      sizeBytes += stat.size;
      itemCount += 1;
      return;
    }
    if (!stat.isDirectory()) return;
    let entries;
    try {
      entries = await readdir(current);
    } catch {
      return;
    }
    for (const entry of entries) await visit(path.join(current, entry));
  }

  await visit(root);
  candidates.sort((a, b) => a.path.localeCompare(b.path));
  return { sizeBytes, itemCount, candidates, truncated };
}

function cleanupCandidates(kind: StorageKind, candidates: Candidate[]): Candidate[] {
  const now = Date.now();
  if (kind === "temporary") return candidates.filter((item) => item.modifiedMs < now - 24 * 60 * 60 * 1000);
  if (kind === "logs") return candidates.filter((item) => item.modifiedMs < now - 7 * 24 * 60 * 60 * 1000);
  if (kind === "cache" || kind === "archivedSessions") return candidates;
  return [];
}

function toRecord(kind: StorageKind, target: string, measurement: Measurement): StorageRecord {
  const selected = cleanupCandidates(kind, measurement.candidates);
  const fingerprint = selected.length ? createHash("sha256")
    .update(selected.map((item) => `${path.relative(target, item.path)}\0${item.sizeBytes}\0${item.modifiedMs}`).join("\n"))
    .digest("hex") : undefined;
  const definition = definitions[kind];
  return {
    id: target,
    kind,
    title: definition.title,
    path: target,
    sizeBytes: measurement.sizeBytes,
    itemCount: measurement.itemCount,
    reclaimableSizeBytes: selected.reduce((sum, item) => sum + item.sizeBytes, 0),
    reclaimableItemCount: selected.length,
    cleanupFingerprint: fingerprint,
    cleanupLevel: definition.level,
    cleanupImpact: measurement.truncated ? `${definition.impact} 扫描达到文件数量上限，当前保持只读。` : definition.impact,
  };
}

function classify(name: string): StorageKind {
  const direct = Object.entries(definitions).find(([, definition]) => definition.component?.toLowerCase() === name.toLowerCase());
  if (direct) return direct[0] as StorageKind;
  if (/\.(sqlite|db)(?:-(?:wal|shm))?$/i.test(name)) return "database";
  return "other";
}
