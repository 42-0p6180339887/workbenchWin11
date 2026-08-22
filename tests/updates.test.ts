import { describe, expect, it } from "vitest";
import { resolveUpdateDistribution } from "../src/shared/updates";

describe("update distribution", () => {
  it("allows the installed package to use the NSIS updater", () => {
    expect(resolveUpdateDistribution(true)).toBe("installed");
  });

  it("keeps portable and development builds off the installer channel", () => {
    expect(resolveUpdateDistribution(true, "C:\\Apps\\Workbench.exe")).toBe("portable");
    expect(resolveUpdateDistribution(false)).toBe("development");
  });
});
