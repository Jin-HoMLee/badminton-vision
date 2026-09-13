import { access, readFile, rename, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root, "dist");
const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
const output = join(root, `badminton-vision-extension-v${manifest.version}.zip`);
const temporaryOutput = join(root, `.${manifest.version}.${process.pid}.zip.tmp`);
await access(join(dist, "manifest.json"));
await rm(temporaryOutput, { force: true });
try {
  await execFileAsync("zip", ["-qr", temporaryOutput, "."], { cwd: dist });
  await rename(temporaryOutput, output);
} catch (error) {
  await rm(temporaryOutput, { force: true });
  throw error;
}
console.log(`Packed ${dist} as ${output}`);
