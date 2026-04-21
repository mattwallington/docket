#!/usr/bin/env node
// Integration test: boots Electron with DOCKET_SECURITY_CHECK=1 and verifies
// the renderer's IPC security model (Phase 1 plan Task 14).

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const electronBin = require('electron');
const appPath = path.resolve(__dirname, '..');
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-sec-'));

const child = spawn(electronBin, [appPath], {
  env: { ...process.env, DOCKET_SECURITY_CHECK: '1', DOCKET_HOME: tmpHome },
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

  const match = stdout.match(/SECURITY_CHECK_RESULT:(.+)/);
  if (!match) {
    return fail(`No SECURITY_CHECK_RESULT line.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
  }

  const result = JSON.parse(match[1]);
  const checks = [
    ['typeof require === undefined', result.requireUndefined],
    ['typeof process === undefined', result.processUndefined],
    ['typeof global === undefined', result.globalUndefined],
    ['readFile(/etc/passwd) rejected', result.etcPasswdRejected],
    ['readFile(/tmp/../etc/passwd) rejected', result.traversalRejected]
  ];

  let allPass = true;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) allPass = false;
  }

  if (result.etcPasswdError) console.log(`    /etc/passwd error: ${result.etcPasswdError}`);
  if (result.traversalError) console.log(`    traversal error: ${result.traversalError}`);

  if (!allPass || exitCode !== 0) {
    return fail(`Security check failed (exit ${exitCode})`);
  }
  console.log('\nAll 5 IPC security assertions pass.');
  process.exit(0);
});

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
