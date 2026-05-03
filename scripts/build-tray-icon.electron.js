const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const outDir = process.env.DOCKET_TRAY_OUT;
  const svgPath = path.join(__dirname, '..', 'assets', 'tray-icon.svg');
  const svg = fs.readFileSync(svgPath, 'utf8');
  const html = `<!doctype html><html><head><style>html,body{margin:0;padding:0;width:32px;height:32px;background:transparent;}svg{display:block;width:100%;height:100%;}</style></head><body>${svg}</body></html>`;

  const win = new BrowserWindow({
    width: 32, height: 32, show: false, transparent: true, frame: false,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  await new Promise((r) => setTimeout(r, 200));
  const image = await win.webContents.capturePage();
  const sizes = [
    ['tray-iconTemplate.png', 16],
    ['tray-iconTemplate@2x.png', 32]
  ];
  for (const [name, size] of sizes) {
    const resized = image.resize({ width: size, height: size, quality: 'best' });
    fs.writeFileSync(path.join(outDir, name), resized.toPNG());
    process.stdout.write(`  wrote ${name} (${size}x${size})\n`);
  }
  app.exit(0);
});
