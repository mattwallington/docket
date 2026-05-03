#!/usr/bin/env node
// Smoke test: spawn Electron with a temp .md file as a CLI argument and verify
// it launches without crashing within 5 seconds.
//
// The golden-path harness (DOCKET_GOLDEN_PATH) cannot be reused here because
// that harness locates the file via the sidebar button, which requires the file
// to be inside a configured root. A CLI-supplied file that lives in a tmp
// directory is outside any root, so step1 / step2 would never find it.
// This simpler "no-crash within 5s" check is sufficient to verify that the
// parseCliMarkdownArg → handleOpenPath → docket:open-path code path does not
// blow up on launch.

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const electronBin = require('electron');
const appPath = path.resolve(__dirname, '..');

// Create a temp dir + markdown file so the file actually exists on disk.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-cli-'));
const tmpFile = path.join(tmpDir, 'cli-test.md');
fs.writeFileSync(tmpFile, '# CLI MARKER\n\nbody.\n');

// Use a fresh DOCKET_HOME so the test never touches the real user config.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-cli-home-'));

const child = spawn(electronBin, [appPath, tmpFile], {
  env: {
    ...process.env,
    DOCKET_HOME: tmpHome
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => { stdout += d.toString(); process.stdout.write(d); });
child.stderr.on('data', (d) => { stderr += d.toString(); process.stderr.write(d); });

let finished = false;

// If the process exits before our timeout fires, something went wrong.
child.on('exit', (code) => {
  if (finished) return;
  finished = true;
  cleanup();
  if (code !== 0) {
    process.stderr.write(`verify-cli-arg: Electron exited unexpectedly (code ${code})\n`);
    process.stderr.write(`stdout:\n${stdout}\nstderr:\n${stderr}\n`);
    process.exit(1);
  }
  // Clean exit before timeout — also fine (e.g. CI headless graceful quit).
  console.log('verify-cli-arg: Electron exited cleanly.');
  process.exit(0);
});

// Give Electron 10 seconds to boot and settle.  If still running at that
// point, the CLI path is working (no crash), so we kill it and report success.
const timeout = setTimeout(() => {
  if (finished) return;
  finished = true;
  try { child.kill('SIGKILL'); } catch {}
  cleanup();
  console.log('verify-cli-arg: Electron alive after 10s — CLI arg path OK.');
  process.exit(0);
}, 10000);

timeout.unref(); // don't keep the process alive purely because of the timer

function cleanup() {
  clearTimeout(timeout);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
}
