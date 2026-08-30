import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.onnx': 'application/octet-stream', '.wasm': 'application/wasm', '.css': 'text/css; charset=utf-8',
};

const server = createServer(async (request, response) => {
  const requestPath = decodeURIComponent((request.url || '/').split('?')[0]);
  const candidate = resolve(join(root, requestPath === '/' ? 'index.html' : requestPath.slice(1)));
  if (!candidate.startsWith(`${root}/`) && candidate !== root) {
    response.writeHead(403); response.end('forbidden'); return;
  }
  if (!existsSync(candidate)) { response.writeHead(404); response.end('not found'); return; }
  try {
    const body = await readFile(candidate);
    response.writeHead(200, {
      'Content-Type': mime[extname(candidate)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      // Cross-origin isolation is not required for the single-threaded WASM
      // benchmark, but these headers match the shape of an extension page.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500); response.end(String(error));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`TrackNet spike server: http://127.0.0.1:${port}/`);
});
