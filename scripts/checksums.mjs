import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const output = path.resolve("release", "windows");
const files = (await readdir(output)).filter((name) => name.toLowerCase().endsWith(".exe")).sort();
if (!files.length) throw new Error(`No Windows executables found in ${output}`);

for (const name of files) {
  const filePath = path.join(output, name);
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  const digest = hash.digest("hex");
  await writeFile(`${filePath}.sha256`, `${digest}  ${name}\n`, "ascii");
  console.log(`${digest}  ${name}`);
}
