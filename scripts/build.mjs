import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const src = join(root, "src");
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of await readdir(src)) {
  const info = await stat(join(src, file));
  if (info.isFile()) await cp(join(src, file), join(dist, file));
}
await cp(join(root, "manifest.json"), join(dist, "manifest.json"));
await cp(join(root, "design-system"), join(dist, "design-system"), { recursive: true });
await rm(join(dist, "design-system", ".thumbnail"), { force: true });
await rm(join(dist, "design-system", "_ds_bundle.js"), { force: true });

const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
const required = ["popup.html", "summary.html", "content.js", "runtime.js", "styles.css", "design-system/assets/icon.svg"];
for (const file of required) {
  try { await stat(join(dist, file)); } catch { throw new Error(`Missing build output: ${file}`); }
}
if (manifest.manifest_version !== 3) throw new Error("The extension must be Manifest V3");
console.log(`Built loadable MV3 extension in ${dist}`);
