const path = require("node:path");
const { locateCodex } = require("../dist/main/services/codex-locator.js");
const { CodexService } = require("../dist/main/services/codex-service.js");

process.env.WORKBENCH_BUNDLED_CODEX ||= path.join(
  __dirname,
  "..",
  "node_modules",
  "@openai",
  "codex-win32-x64",
  "vendor",
  "x86_64-pc-windows-msvc",
  "bin",
  "codex.exe",
);

(async () => {
  const executable = await locateCodex();
  console.log(JSON.stringify({ executable }));
  if (!executable) process.exitCode = 2;
  else {
    const service = new CodexService();
    try {
      const info = await service.connect(executable, "probe");
      console.log(JSON.stringify({ info }));
      const skills = await service.listSkills(process.cwd(), false);
      console.log(JSON.stringify({ skillCount: skills.skills.length, warnings: skills.warnings.length }));
    } finally {
      await service.disconnect();
    }
  }
})().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
