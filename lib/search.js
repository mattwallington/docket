const { spawn } = require('child_process');
// In packaged builds, electron-builder auto-extracts the ripgrep binary to
// app.asar.unpacked/. The path returned by @vscode/ripgrep still points
// inside app.asar (where the binary doesn't actually exist as a real file),
// so we rewrite it. In dev, the substring isn't present and this is a no-op.
const { rgPath: rawRgPath } = require('@vscode/ripgrep');
const rgPath = rawRgPath.replace('app.asar/', 'app.asar.unpacked/');

const MAX_HITS = 50;
const MAX_PER_FILE = 5;
let currentProcess = null;

function cancelSearch() {
  if (currentProcess && !currentProcess.killed) {
    currentProcess.kill();
  }
  currentProcess = null;
}

function searchContent(query, rootPaths) {
  return new Promise((resolve) => {
    if (!query || !query.trim()) {
      resolve([]);
      return;
    }
    if (!rootPaths || rootPaths.length === 0) {
      resolve([]);
      return;
    }

    cancelSearch();

    const args = [
      '--json',
      '-i',
      `--max-count=${MAX_PER_FILE}`,
      '--type=md',
      '-e', query,
      ...rootPaths
    ];
    const proc = spawn(rgPath, args);
    currentProcess = proc;

    const hits = [];
    let buffer = '';

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        if (hits.length >= MAX_HITS) break;
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'match' && obj.data) {
            hits.push({
              absolutePath: obj.data.path.text,
              line: obj.data.line_number,
              snippet: obj.data.lines.text.replace(/\n$/, '')
            });
          }
        } catch {
          // ignore malformed lines
        }
      }
      if (hits.length >= MAX_HITS) proc.kill();
    });

    proc.on('close', () => {
      if (currentProcess === proc) currentProcess = null;
      resolve(hits);
    });

    proc.on('error', () => {
      if (currentProcess === proc) currentProcess = null;
      resolve(hits);
    });
  });
}

module.exports = { searchContent, cancelSearch };
