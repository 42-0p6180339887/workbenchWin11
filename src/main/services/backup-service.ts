import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BackupPreview, BackupStatus } from "../../shared/types";
import { safeRepository, sanitize } from "../security";
import { runCommand } from "./command";

interface BackupEntry {
  relativePath: string;
  contents: string;
  note: string;
}

export class BackupService {
  async status(lastBackupAt?: string): Promise<BackupStatus> {
    try {
      await runCommand("where.exe", ["gh"], { timeout: 5_000 });
    } catch {
      return { cliAvailable: false, signedIn: false, detail: "未安装 GitHub CLI；只影响可选的云端备份。", lastBackupAt };
    }
    try {
      const result = await runCommand("gh", ["api", "user", "--jq", ".login"], { timeout: 15_000 });
      const login = sanitize(result.stdout.trim());
      return { cliAvailable: true, signedIn: Boolean(login), login: login || undefined, detail: login ? `GitHub 已登录：${login}` : "GitHub CLI 尚未登录。", lastBackupAt };
    } catch {
      return { cliAvailable: true, signedIn: false, detail: "GitHub CLI 已安装，但尚未登录。", lastBackupAt };
    }
  }

  async preview(codexHome: string, repository: string): Promise<BackupPreview> {
    if (!safeRepository(repository)) throw new Error("仓库名称必须是 owner/name。");
    const entries = await collectEntries(codexHome);
    return {
      repository,
      files: entries.map((entry) => ({ path: entry.relativePath, sizeBytes: Buffer.byteLength(entry.contents), note: entry.note })),
      warnings: [
        "仅包含白名单中的配置、规则和 Skill 说明。",
        "疑似密钥、令牌、密码和授权头所在行会被整行替换。",
        "上传前仍应核对目标为私人仓库。",
      ],
    };
  }

  async run(codexHome: string, repository: string): Promise<{ files: number; commit: string }> {
    if (!safeRepository(repository)) throw new Error("仓库名称必须是 owner/name。");
    const repoInfo = JSON.parse((await runCommand("gh", ["repo", "view", repository, "--json", "nameWithOwner,visibility,defaultBranchRef"], { timeout: 20_000 })).stdout) as {
      nameWithOwner?: string;
      visibility?: string;
      defaultBranchRef?: { name?: string };
    };
    if (repoInfo.nameWithOwner?.toLowerCase() !== repository.toLowerCase()) throw new Error("GitHub 返回的仓库与目标不一致。");
    if (repoInfo.visibility !== "PRIVATE") throw new Error("Workbench 只允许备份到私人仓库。");
    if (!repoInfo.defaultBranchRef?.name) throw new Error("目标私人仓库需要先初始化一个默认分支。");

    const entries = await collectEntries(codexHome);
    if (!entries.length) throw new Error("没有找到可安全备份的白名单文件。");
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-backup-"));
    const checkout = path.join(tempRoot, "repository");
    try {
      await runCommand("gh", ["repo", "clone", repository, checkout, "--", "--depth", "1"], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
      const backupRoot = path.join(checkout, "codex-backup");
      await mkdir(backupRoot, { recursive: true });
      for (const entry of entries) {
        const destination = path.join(backupRoot, entry.relativePath);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, entry.contents, "utf8");
      }
      const manifest = {
        format: 1,
        generatedAt: new Date().toISOString(),
        platform: "windows",
        files: entries.map((entry) => ({ path: entry.relativePath, note: entry.note })),
      };
      await writeFile(path.join(backupRoot, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await runCommand("git", ["config", "user.name", "Workbench"], { cwd: checkout });
      await runCommand("git", ["config", "user.email", "workbench@localhost"], { cwd: checkout });
      await runCommand("git", ["add", "--all", "--", "codex-backup"], { cwd: checkout });
      const status = await runCommand("git", ["status", "--porcelain", "--", "codex-backup"], { cwd: checkout });
      if (!status.stdout.trim()) return { files: entries.length, commit: "没有变化" };
      const message = `backup: update Codex configuration ${new Date().toISOString().slice(0, 10)}`;
      await runCommand("git", ["commit", "-m", message], { cwd: checkout, timeout: 30_000 });
      const commit = (await runCommand("git", ["rev-parse", "--short", "HEAD"], { cwd: checkout })).stdout.trim();
      await runCommand("git", ["push", "origin", `HEAD:${repoInfo.defaultBranchRef.name}`], { cwd: checkout, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
      return { files: entries.length, commit };
    } finally {
      const resolved = path.resolve(tempRoot);
      const allowedPrefix = path.resolve(os.tmpdir()) + path.sep;
      if (resolved.startsWith(allowedPrefix) && path.basename(resolved).startsWith("workbench-backup-")) {
        await rm(resolved, { recursive: true, force: true });
      }
    }
  }
}

async function collectEntries(codexHome: string): Promise<BackupEntry[]> {
  const entries: BackupEntry[] = [];
  const direct = [
    ["config.toml", "Codex 个人配置（已脱敏）"],
    ["AGENTS.md", "Codex 全局说明"],
    [path.join("rules", "default.rules"), "默认执行规则"],
  ] as const;
  for (const [relativePath, note] of direct) {
    const entry = await readSafeText(codexHome, relativePath, note);
    if (entry) entries.push(entry);
  }

  const skillsRoot = path.join(codexHome, "skills");
  try {
    const skillDirectories = await readdir(skillsRoot, { withFileTypes: true });
    for (const directory of skillDirectories.slice(0, 500)) {
      if (!directory.isDirectory() || directory.isSymbolicLink()) continue;
      for (const suffix of ["SKILL.md", path.join("agents", "openai.yaml"), path.join("agents", "openai.yml")]) {
        const relative = path.join("skills", directory.name, suffix);
        const entry = await readSafeText(codexHome, relative, "Skill 定义与调用策略");
        if (entry) entries.push(entry);
      }
    }
  } catch {
    // Skills are optional.
  }
  const total = entries.reduce((sum, entry) => sum + Buffer.byteLength(entry.contents), 0);
  if (total > 20 * 1024 * 1024) throw new Error("备份预览超过 20 MB，已停止生成。");
  return entries;
}

async function readSafeText(codexHome: string, relativePath: string, note: string): Promise<BackupEntry | undefined> {
  const absolute = path.join(codexHome, relativePath);
  try {
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) return undefined;
    const contents = await readFile(absolute, "utf8");
    return { relativePath: relativePath.split(path.sep).join("/"), contents: redactFile(contents), note };
  } catch {
    return undefined;
  }
}

function redactFile(contents: string): string {
  return contents.split(/\r?\n/).map((line) => {
    if (/(api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|password|client[_-]?secret|authorization|private[_-]?key|bearer\s|ghp_|github_pat_|sk-)/i.test(line)) {
      return "# [敏感配置已隐藏]";
    }
    return sanitize(line, 8_000);
  }).join("\n");
}
