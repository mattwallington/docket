const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

// Use the existing main.js DOCKET_BUILD_ICON harness, but run a custom flow:
// the harness writes Mac iconset names. For tray we only need 2 sizes, so do
// it inline here using Electron's nativeImage at runtime by spawning electron
// with a one-shot script.
const electron = require('electron');
const child = spawnSync(electron, [path.join(__dirname, 'build-tray-icon.electron.js')], {
  stdio: 'inherit',
  env: { ...process.env, DOCKET_TRAY_OUT: outDir }
});
process.exit(child.status || 0);
