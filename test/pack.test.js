const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

test('pack preserves the existing archive when zip fails', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'bso-pack-'));
  try {
    fs.mkdirSync(path.join(project, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(project, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(project, 'scripts/pack.mjs'), fs.readFileSync('scripts/pack.mjs'));
    fs.writeFileSync(path.join(project, 'dist/manifest.json'), JSON.stringify({ version: '9.9.9' }));
    const archive = path.join(project, 'badminton-vision-extension-v9.9.9.zip');
    fs.writeFileSync(archive, 'known-good-release');
    const bin = path.join(project, 'bin');
    fs.mkdirSync(bin);
    const failingZip = path.join(bin, 'zip');
    fs.writeFileSync(failingZip, '#!/usr/bin/env node\nprocess.exit(1);\n', { mode: 0o755 });
    const result = spawnSync(process.execPath, [path.join(project, 'scripts/pack.mjs')], {
      cwd: project,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(archive, 'utf8'), 'known-good-release');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});
