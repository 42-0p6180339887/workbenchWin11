import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export async function runCommand(
  executable: string,
  args: string[],
  options: { cwd?: string; timeout?: number; input?: string; maxBuffer?: number } = {},
): Promise<CommandResult> {
  if (options.input !== undefined) {
    return await new Promise((resolve, reject) => {
      const child = execFile(
        executable,
        args,
        {
          cwd: options.cwd,
          timeout: options.timeout ?? 20_000,
          windowsHide: true,
          maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
          encoding: "utf8",
        },
        (error, stdout, stderr) => {
          if (error) reject(Object.assign(error, { stdout, stderr }));
          else resolve({ stdout, stderr });
        },
      );
      child.stdin?.end(options.input, "utf8");
    });
  }
  const result = await execFileAsync(executable, args, {
    cwd: options.cwd,
    timeout: options.timeout ?? 20_000,
    windowsHide: true,
    maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
    encoding: "utf8",
  });
  return { stdout: result.stdout, stderr: result.stderr };
}
