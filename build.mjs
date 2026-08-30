import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const source = resolve(root, 'src/extension');
const output = resolve(root, 'dist');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });

const manifest = JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3 || !manifest.background?.service_worker || !manifest.permissions?.includes('offscreen')) {
  throw new Error('The source manifest is not a complete MV3 manifest');
}
await writeFile(resolve(output, 'build-info.json'), JSON.stringify({
  name: manifest.name,
  version: manifest.version,
  builtAt: new Date().toISOString()
}, null, 2) + '\n');
console.log(`Built ${manifest.name} ${manifest.version} -> ${output}`);
