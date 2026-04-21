#!/usr/bin/env node
// Validates expected release artifacts exist after electron-builder runs.
// release.sh attaches them to the GitHub release in the next step.

const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '../dist');
const version = fs.readFileSync(path.resolve(__dirname, '../VERSION'), 'utf8').trim();

const expected = [
  `docket-${version}-arm64-mac.zip`,
  `docket-${version}-x64-mac.zip`,
  `docket-${version}-arm64-mac.dmg`,
  `docket-${version}-x64-mac.dmg`,
  'latest-mac.yml'
];

console.log('Expected release artifacts:');
let missing = 0;
for (const f of expected) {
  const p = path.join(distDir, f);
  const ok = fs.existsSync(p);
  console.log(`  ${ok ? '✓' : '✗'} ${f}`);
  if (!ok) missing++;
}
if (missing > 0) {
  console.error(`\n${missing} expected artifact(s) missing in ${distDir}`);
  process.exit(1);
}
