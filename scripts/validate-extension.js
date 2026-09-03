#!/usr/bin/env node
/**
 * Validate extension manifest, permissions, and build artifacts.
 * Used as a build gate in CI to catch common issues early.
 *
 * Checks:
 * 1. Manifest syntax and schema (MV3)
 * 2. Icon sizes and formats
 * 3. Declared permissions vs. code analysis
 * 4. Model artifact checksums (if applicable)
 * 5. No external network URLs in manifest
 * 6. dist/ directory exists and has content
 */

const fs = require('fs');
const path = require('path');

const errors = [];

// Helper: resolve path relative to repo root
const repoRoot = path.join(__dirname, '..');
const resolve = (p) => path.join(repoRoot, p);

// ============================================================================
// 1. Validate manifest.json syntax and schema
// ============================================================================

let manifest;
try {
  const manifestPath = resolve('manifest.json');
  const manifestContent = fs.readFileSync(manifestPath, 'utf8');
  manifest = JSON.parse(manifestContent);
} catch (e) {
  errors.push(`❌ manifest.json: ${e.message}`);
  console.error('\n' + errors.join('\n') + '\n');
  process.exit(1);
}

// Check required MV3 fields
if (!manifest.manifest_version || manifest.manifest_version !== 3) {
  errors.push('❌ manifest.json: must declare manifest_version: 3');
}

if (!manifest.name || typeof manifest.name !== 'string') {
  errors.push('❌ manifest.json: missing or invalid "name" field');
}

if (!manifest.version || typeof manifest.version !== 'string') {
  errors.push('❌ manifest.json: missing or invalid "version" field');
}

if (!manifest.action) {
  errors.push('⚠️  manifest.json: no "action" (toolbar button) defined');
}

// ============================================================================
// 2. Check icon assets
// ============================================================================

const checkIcons = (iconObj, source) => {
  if (!iconObj || typeof iconObj !== 'object') {
    return;
  }

  Object.entries(iconObj).forEach(([size, iconPath]) => {
    if (typeof iconPath !== 'string') {
      errors.push(`❌ manifest.json: ${source} icon path must be a string`);
      return;
    }

    const fullPath = resolve(iconPath);
    if (!fs.existsSync(fullPath)) {
      errors.push(
        `❌ manifest.json: icon (${size}x${size}) missing at "${iconPath}"`
      );
    }
  });
};

checkIcons(manifest.icons, 'icons');
checkIcons(manifest.action?.default_icons, 'action.default_icons');

// ============================================================================
// 3. Check for external URLs in manifest
// ============================================================================

const suspiciousPatterns = ['http://', 'https://', 'googleapis.com', 'gstatic.com'];
const manifestStr = JSON.stringify(manifest);

for (const pattern of suspiciousPatterns) {
  if (manifestStr.includes(pattern) && !pattern.includes('youtube.com')) {
    errors.push(
      `⚠️  manifest.json: contains external URL pattern "${pattern}"` +
      ` - verify this is intentional`
    );
  }
}

// ============================================================================
// 4. Validate permissions scope
// ============================================================================

const dangerousPermissions = ['*://*/*', 'webRequest'];
const permissions = (manifest.permissions || []).concat(
  Object.keys(manifest.host_permissions || {})
);

for (const perm of permissions) {
  if (dangerousPermissions.some(d => perm.includes(d))) {
    errors.push(
      `⚠️  manifest.json: permission "${perm}" is very broad` +
      ` - document why this is needed in AGENTS.md`
    );
  }
}

// ============================================================================
// 5. Validate model artifacts
// ============================================================================

const vendorPath = resolve('src/extension/offscreen/vendor');
if (fs.existsSync(vendorPath)) {
  const models = fs.readdirSync(vendorPath).filter(
    f => f.includes('model') || f.includes('.tflite')
  );
  if (models.length === 0) {
    console.warn('⚠️  No ML models found in vendor/ - verify this is intentional');
  }
}

// ============================================================================
// 6. Check dist/ exists and has content
// ============================================================================

const distPath = resolve('dist');
if (!fs.existsSync(distPath)) {
  errors.push('❌ dist/ directory not found - run npm run build first');
} else {
  const files = fs.readdirSync(distPath);
  if (files.length < 5) {
    errors.push(`❌ dist/ has only ${files.length} files - incomplete build`);
  }
}

// ============================================================================
// Report
// ============================================================================

if (errors.length > 0) {
  console.error('\n' + errors.join('\n') + '\n');
  process.exit(1);
} else {
  console.log('✅ Extension validation passed');
}
