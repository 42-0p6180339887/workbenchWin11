import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

const secretPatterns: Array<[RegExp, string]> = [
  [/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[已隐藏]"],
  [/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*[=:]\s*["']?)[^\s"']+/gi, "$1[已隐藏]"],
  [/([?&](?:token|key|secret|signature)=)[^&#\s]+/gi, "$1[已隐藏]"],
  [/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[凭据]@"],
  [/(sk-[A-Za-z0-9_-]{12,})/g, "[已隐藏的密钥]"],
  [/(gh[opusr]_[A-Za-z0-9]{20,})/g, "[已隐藏的 GitHub 凭据]"],
];

export function sanitize(value: unknown, maximumLength = 4_000): string {
  let text = String(value ?? "");
  for (const [pattern, replacement] of secretPatterns) text = text.replace(pattern, replacement);
  return text.slice(0, maximumLength);
}

export function pathSummary(value: string): string {
  const normalized = path.normalize(value);
  const home = process.env.USERPROFILE ?? process.env.HOME;
  return home && normalized.toLowerCase().startsWith(path.normalize(home).toLowerCase())
    ? `~${normalized.slice(path.normalize(home).length)}`
    : normalized;
}

export function commandSummary(command: string | undefined): string | undefined {
  if (!command) return undefined;
  const trimmed = command.trim();
  if (!trimmed) return undefined;
  const first = trimmed.startsWith('"')
    ? trimmed.slice(1, trimmed.indexOf('"', 1) > 0 ? trimmed.indexOf('"', 1) : undefined)
    : trimmed.split(/\s+/, 1)[0];
  return path.basename(first);
}

export function isSafeConfigKey(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

export function isInside(child: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function assertSafeRegularFile(filePath: string, allowedRoots: string[]): Promise<string> {
  const resolved = await realpath(filePath);
  if (!allowedRoots.some((root) => isInside(resolved, root))) throw new Error("文件不在允许修改的目录内。");
  const stat = await lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("目标不是可安全修改的普通文件。");
  return resolved;
}

export function safeRepository(value: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}
