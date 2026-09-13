import { access, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root, "dist");
const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
const output = join(root, `badminton-vision-extension-v${manifest.version}.zip`);
await access(join(dist, "manifest.json"));
await rm(output, { force: true });
await execFileAsync("zip", ["-qr", output, "."], { cwd: dist });
console.log(`Packed ${dist} as ${output}`);
