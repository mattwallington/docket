#!/usr/bin/env node
// Smoke test: boots Electron with a seeded DOCKET_HOME, clicks a file,
// verifies it renders, then writes new content to disk and verifies the
// renderer picks up the change within 1.5s.

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const electronBin = require('electron');
const appPath = path.resolve(__dirname, '..');
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-gp-'));
const projectsDir = path.join(tmpHome, 'projects');
fs.mkdirSync(projectsDir, { recursive: true });
const seededFile = path.join(projectsDir, 'golden.md');
fs.writeFileSync(seededFile, '# Golden Path\n\nINITIAL_MARKER body.\n');

const child = spawn(electronBin, [appPath], {
  env: {
    ...process.env,
    DOCKET_GOLDEN_PATH: '1',
    DOCKET_HOME: tmpHome,
    DOCKET_GOLDEN_FILE: seededFile
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (c) => { stdout += c.toString(); });
child.stderr.on('data', (c) => { stderr += c.toString(); });

const timeout = setTimeout(() => {
  child.kill('SIGKILL');
  fail('Timed out after 30s');
}, 30000);

child.on('exit', (exitCode) => {
  clearTimeout(timeout);
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}

  const errLine = stdout.match(/GOLDEN_PATH_ERROR:(.+)/);
  if (errLine) return fail(`Error from main: ${errLine[1]}\nstdout:\n${stdout}\nstderr:\n${stderr}`);

  const match = stdout.match(/GOLDEN_PATH_RESULT:(.+)/);
  if (!match) return fail(`No GOLDEN_PATH_RESULT line (exit ${exitCode}).\nstdout:\n${stdout}\nstderr:\n${stderr}`);

  const result = JSON.parse(match[1]);
  console.log(`  ${result.step === 'done' && result.ok ? '✓' : '✗'} step=${result.step} ok=${result.ok}` + (result.fileCount ? ` (${result.fileCount} files indexed)` : ''));
  if (result.step2) console.log(`    click step: ${JSON.stringify(result.step2)}`);
  if (result.step1 && result.step === 'list') console.log(`    list step: ${JSON.stringify(result.step1)}`);

  if (exitCode !== 0 || !result.ok) return fail(`Golden path failed (exit ${exitCode})`);
  console.log('\nGolden path: launch → sidebar → open → render → live refresh — all pass.');
  process.exit(0);
});

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
