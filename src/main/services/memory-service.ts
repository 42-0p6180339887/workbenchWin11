import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { MemoryRecord, MemorySnapshot } from "../../shared/types";
import { isInside, sanitize } from "../security";

const maximumFiles = 1_000;
const maximumFileBytes = 512 * 1024;
const maximumPreviewBytes = 8 * 1024;

export async function scanMemory(codexHome: string): Promise<MemorySnapshot> {
  const warnings: string[] = [];
  let home: string;
  try {
    home = await realpath(codexHome);
    const stat = await lstat(home);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
  } catch {
    return { records: [], visibleRecords: [], warnings: ["Codex Home 不存在或不是安全目录。"], totalBytes: 0 };
  }

  const rootCandidate = path.join(home, "memories");
  let root: string;
  try {
    root = await realpath(rootCandidate);
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !isInside(root, home)) throw new Error();
  } catch {
    return { records: [], visibleRecords: [], warnings: ["Codex memories 目录不存在或不是安全目录。"], totalBytes: 0 };
  }

  const records: MemoryRecord[] = [];
  async function visit(current: string): Promise<void> {
    if (records.length >= maximumFiles) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      warnings.push(`无法读取 ${path.basename(current)}。`);
      return;
    }
    for (const entry of entries) {
      if (records.length >= maximumFiles) return;
      if (entry.name.startsWith(".")) continue;
      const absolutePath = path.join(current, entry.name);
      let stat;
      try {
        stat = await lstat(absolutePath);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        warnings.push("已跳过 Memory 中的符号链接。");
        continue;
      }
      if (stat.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!stat.isFile() || !/\.(md|markdown)$/i.test(entry.name)) continue;
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      const kind = classify(relativePath);
      const status = stat.size > maximumFileBytes ? "tooLarge" : "available";
      let preview: string | undefined;
      let lineCount = 0;
      let effectiveStatus: MemoryRecord["status"] = status;
      if (status === "available") {
        try {
          const result = await readPreview(absolutePath);
          preview = result.preview;
          lineCount = result.lineCount;
        } catch {
          effectiveStatus = "unreadable";
        }
      }
      records.push({
        id: absolutePath,
        title: titleFor(relativePath, kind),
        relativePath,
        absolutePath,
        kind,
        status: effectiveStatus,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        lineCount,
        preview: ["raw"].includes(kind) ? undefined : preview,
      });
    }
  }

  await visit(root);
  if (records.length >= maximumFiles) warnings.push(`Memory 文件达到 ${maximumFiles} 个，已停止继续扫描。`);
  records.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || a.relativePath.localeCompare(b.relativePath, "zh-CN"));
  return {
    records,
    visibleRecords: records.filter((record) => record.kind !== "raw"),
    warnings,
    totalBytes: records.reduce((sum, record) => sum + record.sizeBytes, 0),
  };
}

async function readPreview(filePath: string): Promise<{ preview?: string; lineCount: number }> {
  const entire = await readFile(filePath, "utf8");
  const previewSource = Buffer.from(entire, "utf8").subarray(0, maximumPreviewBytes).toString("utf8");
  const preview = previewSource.split(/\r?\n/)
    .map((line) => sensitiveLine(line) ? "[敏感内容已隐藏]" : sanitize(line, 2_000))
    .slice(0, 18)
    .join("\n")
    .trim()
    .slice(0, 720) || undefined;
  return { preview, lineCount: entire ? entire.split(/\r?\n/).length : 0 };
}

function sensitiveLine(line: string): boolean {
  return /(api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|authorization|private[_-]?key|bearer\s|ghp_|github_pat_|sk-)/i.test(line);
}

function classify(relativePath: string): MemoryRecord["kind"] {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized === "MEMORY.md") return "durable";
  if (normalized === "memory_summary.md") return "summary";
  if (normalized === "raw_memories.md" || normalized.startsWith("extensions/chronicle/")) return "raw";
  if (normalized.startsWith("rollout_summaries/")) return "summary";
  if (normalized.startsWith("extensions/ad_hoc/")) return "active";
  return "other";
}

function titleFor(relativePath: string, kind: MemoryRecord["kind"]): string {
  if (kind === "durable") return "长期记忆";
  if (relativePath === "memory_summary.md") return "当前记忆摘要";
  return path.basename(relativePath, path.extname(relativePath)).replace(/_/g, " ");
}

function kindOrder(kind: MemoryRecord["kind"]): number {
  return ({ active: 0, summary: 1, durable: 2, other: 3, raw: 4 } as Record<MemoryRecord["kind"], number>)[kind];
}
