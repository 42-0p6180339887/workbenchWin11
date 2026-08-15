import path from "node:path";
import { describe, expect, it } from "vitest";
import { commandSummary, isInside, isSafeConfigKey, safeRepository, sanitize } from "../src/main/security";

describe("security boundaries", () => {
  it("redacts common credentials without changing ordinary text", () => {
    const input = "API_KEY=sk-1234567890abcdef Authorization: Bearer abc.def ordinary=value";
    const result = sanitize(input);
    expect(result).not.toContain("sk-1234567890abcdef");
    expect(result).not.toContain("abc.def");
    expect(result).toContain("ordinary=value");
  });

  it("accepts descendants but rejects sibling-prefix paths", () => {
    const root = path.resolve("C:\\Users\\example\\.codex");
    expect(isInside(path.join(root, "skills", "demo", "SKILL.md"), root)).toBe(true);
    expect(isInside(path.resolve("C:\\Users\\example\\.codex-backup", "config.toml"), root)).toBe(false);
  });

  it("limits repository and config identifiers", () => {
    expect(safeRepository("owner/private-backup")).toBe(true);
    expect(safeRepository("https://github.com/owner/repo")).toBe(false);
    expect(isSafeConfigKey("safe-name_01")).toBe(true);
    expect(isSafeConfigKey("mcp.server")).toBe(false);
  });

  it("shows only the executable name in command summaries", () => {
    expect(commandSummary('"C:\\Program Files\\Tool\\runner.exe" --token secret')).toBe("runner.exe");
  });
});
