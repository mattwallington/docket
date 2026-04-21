#!/usr/bin/env node
// Writes build-info.json just before electron-builder packages the app.
// release.sh sets DOCKET_CHANNEL; falls back to 'stable'.

const fs = require('fs');
const path = require('path');

const versionFile = path.resolve(__dirname, '../VERSION');
const version = fs.readFileSync(versionFile, 'utf8').trim();

const buildInfo = {
  version,
  channel: process.env.DOCKET_CHANNEL || 'stable',
  buildDate: new Date().toISOString(),
  buildTimestamp: Date.now()
};

fs.writeFileSync(
  path.resolve(__dirname, '../build-info.json'),
  JSON.stringify(buildInfo, null, 2) + '\n'
);

console.log(`Wrote build-info.json: v${version} (${buildInfo.channel})`);
