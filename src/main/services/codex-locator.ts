import { access, lstat, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./command";

export async function locateCodex(preferredPath?: string): Promise<string | undefined> {
  const candidates: string[] = [];
  if (preferredPath) candidates.push(preferredPath);
  if (process.env.WORKBENCH_BUNDLED_CODEX) candidates.push(process.env.WORKBENCH_BUNDLED_CODEX);
  if (process.env.CODEX_BINARY) candidates.push(process.env.CODEX_BINARY);

  if (process.platform === "win32") {
    try {
      const result = await runCommand("where.exe", ["codex"], { timeout: 5_000 });
      const discovered = result.stdout.split(/\r?\n/).filter(Boolean);
      discovered.sort((left, right) => Number(!left.toLowerCase().endsWith(".exe")) - Number(!right.toLowerCase().endsWith(".exe")));
      candidates.push(...discovered);
    } catch {
      // Continue with deterministic locations.
    }
    const local = process.env.LOCALAPPDATA;
    const programFiles = process.env.ProgramFiles;
    if (local) {
      candidates.push(path.join(local, "Microsoft", "WindowsApps", "codex.exe"));
      candidates.push(path.join(local, "Programs", "Codex", "resources", "codex.exe"));
    }
    if (programFiles) candidates.push(path.join(programFiles, "Codex", "resources", "codex.exe"));
  } else {
    for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
      if (directory) candidates.push(path.join(directory, "codex"));
    }
    candidates.push(path.join(os.homedir(), ".local", "bin", "codex"));
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = path.resolve(candidate.trim().replace(/^"|"$/g, ""));
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      await access(normalized, constants.R_OK);
      const resolved = await realpath(normalized);
      const stat = await lstat(resolved);
      if (!stat.isFile()) continue;
      const version = await runCommand(resolved, ["--version"], { timeout: 8_000 });
      if (/codex(?:-cli)?\s+\d/i.test(`${version.stdout}\n${version.stderr}`)) return resolved;
    } catch {
      // Candidate unavailable.
    }
  }
  return undefined;
}

export async function validateCodexSelection(selection: string): Promise<string> {
  const resolved = await realpath(selection);
  const stat = await lstat(resolved);
  if (!stat.isFile()) throw new Error("所选内容不是 Codex 可执行文件。");
  if (process.platform === "win32" && path.extname(resolved).toLowerCase() !== ".exe") {
    throw new Error("请选择 codex.exe。");
  }
  try {
    const result = await runCommand(resolved, ["--version"], { timeout: 8_000 });
    if (!/codex(?:-cli)?\s+\d/i.test(`${result.stdout}\n${result.stderr}`)) throw new Error();
  } catch {
    throw new Error("所选文件无法作为 Codex CLI 启动，请选择 OpenAI 官方 codex.exe。");
  }
  return resolved;
}
