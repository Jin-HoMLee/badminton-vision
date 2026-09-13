const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-validate-extension-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/extension/offscreen/vendor/lite-openpose'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scripts/validate-extension.js'), path.join(root, 'scripts/validate-extension.js'));
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    name: 'fixture',
    version: '1.0.0',
    action: {},
    icons: { '16': 'icon.png' }
  }));
  fs.writeFileSync(path.join(root, 'icon.png'), 'fixture');
  fs.writeFileSync(path.join(root, 'src/extension/offscreen/vendor/lite-openpose/model-notice.md'), 'notice');
  for (let index = 0; index < 5; index += 1) fs.writeFileSync(path.join(root, 'dist', `file-${index}`), 'fixture');
  return root;
}

function runValidator(root) {
  return childProcess.spawnSync(process.execPath, [path.join(root, 'scripts/validate-extension.js')], {
    encoding: 'utf8'
  });
}

test('validator requires a model artifact instead of treating a model notice as one', () => {
  const root = createFixture();
  try {
    const withoutArtifact = runValidator(root);
    assert.equal(withoutArtifact.status, 0);
    assert.match(withoutArtifact.stderr, /No ML models found in vendor/);

    fs.writeFileSync(path.join(root, 'src/extension/offscreen/vendor/lite-openpose/pose_256.tflite'), 'artifact');
    const withArtifact = runValidator(root);
    assert.equal(withArtifact.status, 0);
    assert.doesNotMatch(withArtifact.stderr, /No ML models found in vendor/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
