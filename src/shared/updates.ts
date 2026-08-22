import type { UpdateDistribution } from "./types";

export function resolveUpdateDistribution(isPackaged: boolean, portableExecutableFile?: string): UpdateDistribution {
  if (!isPackaged) return "development";
  return portableExecutableFile ? "portable" : "installed";
}
