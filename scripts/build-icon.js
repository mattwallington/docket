#!/usr/bin/env node
// Rasterizes assets/icon.svg (and assets/icon-dev.svg if present) into
// macOS .iconset directories using Electron's nativeImage, then wraps
// each into a matching .icns via the system iconutil.

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const electronBin = require('electron');
const appPath = path.resolve(__dirname, '..');

const variants = [
  { svg: 'icon.svg', iconset: 'icon.iconset', icns: 'icon.icns', png: 'icon.png' },
  { svg: 'icon-dev.svg', iconset: 'icon-dev.iconset', icns: 'icon-dev.icns', png: null }
];

async function buildOne({ svg, iconset, icns, png }) {
  const svgAbs = path.join(appPath, 'assets', svg);
  if (!fs.existsSync(svgAbs)) {
    console.log(`(skip) assets/${svg} not found`);
    return;
  }
  const iconsetDir = path.join(appPath, 'assets', iconset);
  const icnsOut = path.join(appPath, 'assets', icns);
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  fs.mkdirSync(iconsetDir, { recursive: true });

  await new Promise((resolve, reject) => {
    const child = spawn(electronBin, [appPath], {
      env: { ...process.env, DOCKET_BUILD_ICON: '1', DOCKET_ICON_OUT: iconsetDir, DOCKET_ICON_SVG: svg },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', (c) => process.stdout.write(c));
    child.stderr.on('data', (c) => process.stderr.write(c));
    child.on('exit', () => {
      const expected = [
        'icon_16x16.png', 'icon_16x16@2x.png',
        'icon_32x32.png', 'icon_32x32@2x.png',
        'icon_128x128.png', 'icon_128x128@2x.png',
        'icon_256x256.png', 'icon_256x256@2x.png',
        'icon_512x512.png', 'icon_512x512@2x.png'
      ];
      const missing = expected.filter((f) => !fs.existsSync(path.join(iconsetDir, f)));
      if (missing.length) return reject(new Error(`Missing: ${missing.join(', ')}`));
      resolve();
    });
  });

  if (png) {
    fs.copyFileSync(path.join(iconsetDir, 'icon_512x512.png'), path.join(appPath, 'assets', png));
  }

  await new Promise((resolve, reject) => {
    const p = spawn('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsOut], { stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('iconutil failed'))));
  });
  console.log(`✓ assets/${icns} (${(fs.statSync(icnsOut).size / 1024).toFixed(1)} KB)`);
}

(async () => {
  for (const v of variants) {
    console.log(`\n== ${v.svg} ==`);
    await buildOne(v);
  }
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
