#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const spikeRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name) => args.includes(name);
const port = Number(value('--port', process.env.PORT || 4173));
const cdpPort = Number(value('--cdp-port', 9229));
const model = value('--model', '/fixtures/tracknet_fixture.onnx');
const resolutions = value('--resolutions', '512x288').split(',');
const backends = (has('--all') ? ['wasm', 'webgl', 'webgpu'] : value('--backends', 'wasm').split(','));
const warmup = Number(value('--warmup', 3));
const iterations = Number(value('--iterations', 20));
const headed = has('--headed');
const chromePath = process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');

class CDP {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolveReady, reject) => {
      this.ws.addEventListener('open', () => resolveReady());
      this.ws.addEventListener('error', reject);
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolveResult, reject) => {
      this.pending.set(id, { resolve: resolveResult, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.ws.close(); }
}

async function waitForJson(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${url}`);
}

function startProcess(command, processArgs, options = {}) {
  const child = spawn(command, processArgs, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  child.stderr.on('data', (chunk) => process.stderr.write(`[child] ${chunk}`));
  return child;
}

const server = startProcess(process.execPath, ['scripts/server.mjs'], { cwd: spikeRoot, env: { ...process.env, PORT: String(port) } });
let chrome;
let cdp;
try {
  await sleep(250);
  const chromeArgs = [
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${join(spikeRoot, '.chrome-profile')}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    ...(headed ? ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=Vulkan'] : ['--headless=new']),
    `http://127.0.0.1:${port}/`,
  ];
  if (!existsSync(chromePath) && !process.env.CHROME_PATH) throw new Error(`Chrome not found at ${chromePath}; set CHROME_PATH`);
  chrome = startProcess(chromePath, chromeArgs);
  const targets = await waitForJson(`http://127.0.0.1:${cdpPort}/json/list`);
  const page = targets.find((target) => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('Chrome did not expose a page target');
  cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  for (let i = 0; i < 100; i += 1) {
    const probe = await cdp.send('Runtime.evaluate', { expression: 'Boolean(window.runSpikeBenchmark)', returnByValue: true });
    if (probe.result?.value) break;
    await sleep(100);
    if (i === 99) throw new Error('spike page did not finish loading');
  }

  const results = [];
  for (const resolution of resolutions) {
    const [width, height] = resolution.split('x').map(Number);
    for (const backend of backends) {
      const expression = `window.runSpikeBenchmark(${JSON.stringify({ modelUrl: model, backend, width, height, warmup, iterations })})`;
      const evaluated = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.text || 'browser evaluation failed');
      results.push(evaluated.result.value);
      console.log(JSON.stringify(results.at(-1), null, 2));
    }
  }
  const output = { schema: 'tracknet-browser-spike-suite/v1', chromePath, headed, port, model, resolutions, backends, results };
  await mkdir(join(spikeRoot, 'results'), { recursive: true });
  const outputPath = join(spikeRoot, 'results', `benchmark-${Date.now()}.json`);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.error(`wrote ${outputPath}`);
} finally {
  cdp?.close();
  chrome?.kill('SIGTERM');
  server.kill('SIGTERM');
}
