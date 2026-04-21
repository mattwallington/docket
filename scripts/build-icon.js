#!/usr/bin/env node
// Rasterizes assets/icon.svg into a macOS .iconset (10 PNGs) using
// Electron's nativeImage resize, then wraps it into assets/icon.icns
// via the system iconutil.

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const electronBin = require('electron');
const appPath = path.resolve(__dirname, '..');
const iconsetDir = path.join(appPath, 'assets', 'icon.iconset');
const icnsOut = path.join(appPath, 'assets', 'icon.icns');
const pngOut = path.join(appPath, 'assets', 'icon.png');

fs.rmSync(iconsetDir, { recursive: true, force: true });
fs.mkdirSync(iconsetDir, { recursive: true });

const child = spawn(electronBin, [appPath], {
  env: { ...process.env, DOCKET_BUILD_ICON: '1', DOCKET_ICON_OUT: iconsetDir },
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', (c) => process.stdout.write(c));
child.stderr.on('data', (c) => process.stderr.write(c));

child.on('exit', (code) => {
  // Accept successful rasterization even if Electron exits non-cleanly, as
  // long as all 10 expected PNGs are on disk.
  const expected = [
    'icon_16x16.png', 'icon_16x16@2x.png',
    'icon_32x32.png', 'icon_32x32@2x.png',
    'icon_128x128.png', 'icon_128x128@2x.png',
    'icon_256x256.png', 'icon_256x256@2x.png',
    'icon_512x512.png', 'icon_512x512@2x.png'
  ];
  const missing = expected.filter((f) => !fs.existsSync(path.join(iconsetDir, f)));
  if (missing.length) {
    console.error(`Rasterization failed (exit ${code}). Missing: ${missing.join(', ')}`);
    process.exit(1);
  }
  // Copy 512x512 as the primary PNG (used as fallback where .icns isn't)
  fs.copyFileSync(path.join(iconsetDir, 'icon_512x512.png'), pngOut);

  const iconutil = spawn('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsOut], { stdio: 'inherit' });
  iconutil.on('exit', (c) => {
    if (c !== 0) {
      console.error('iconutil failed');
      process.exit(1);
    }
    console.log(`\n✓ assets/icon.icns (${(fs.statSync(icnsOut).size / 1024).toFixed(1)} KB)`);
    console.log(`✓ assets/icon.png  (${(fs.statSync(pngOut).size / 1024).toFixed(1)} KB)`);
    process.exit(0);
  });
});
