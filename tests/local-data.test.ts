import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanMemory } from "../src/main/services/memory-service";
import { StorageService } from "../src/main/services/storage-service";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.basename(root).startsWith("workbench-test-")) throw new Error("拒绝清理非测试目录");
    await rm(root, { recursive: true, force: true });
  }
});

async function testRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-test-"));
  roots.push(root);
  return root;
}

describe("local Codex data", () => {
  it("redacts memory previews and counts the complete file", async () => {
    const root = await testRoot();
    const memoryRoot = path.join(root, "memories");
    await mkdir(memoryRoot);
    await writeFile(path.join(memoryRoot, "MEMORY.md"), "# Preference\nAPI_KEY=sk-1234567890abcdef\nKeep answers concise\n", "utf8");

    const result = await scanMemory(root);
    expect(result.visibleRecords).toHaveLength(1);
    expect(result.visibleRecords[0].lineCount).toBe(4);
    expect(result.visibleRecords[0].preview).toContain("[敏感内容已隐藏]");
    expect(result.visibleRecords[0].preview).not.toContain("sk-1234567890abcdef");
  });

  it("accepts a Codex Home path that resolves through an alias", async () => {
    const root = await testRoot();
    const realHome = path.join(root, "real-home");
    const memoryRoot = path.join(realHome, "memories");
    const homeAlias = path.join(root, "home-alias");
    await mkdir(memoryRoot, { recursive: true });
    await writeFile(path.join(memoryRoot, "MEMORY.md"), "# Canonical path\n", "utf8");
    await symlink(realHome, homeAlias, process.platform === "win32" ? "junction" : "dir");

    const result = await scanMemory(homeAlias);
    expect(result.visibleRecords).toHaveLength(1);
    expect(result.visibleRecords[0].relativePath).toBe("MEMORY.md");
  });

  it("marks only old temporary files as reclaimable", async () => {
    const root = await testRoot();
    const temporary = path.join(root, ".tmp");
    await mkdir(temporary);
    const oldFile = path.join(temporary, "old.tmp");
    const freshFile = path.join(temporary, "fresh.tmp");
    await writeFile(oldFile, "old", "utf8");
    await writeFile(freshFile, "fresh", "utf8");
    const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await utimes(oldFile, oldDate, oldDate);

    const records = await new StorageService(async () => undefined).scan(root);
    const record = records.find((item) => item.kind === "temporary");
    expect(record?.itemCount).toBe(2);
    expect(record?.reclaimableItemCount).toBe(1);
    expect(record?.reclaimableSizeBytes).toBe(3);
    expect(record?.cleanupFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
});
