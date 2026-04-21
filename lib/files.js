const fs = require('fs').promises;
const path = require('path');

const MAX_FILES_PER_ROOT = 5000;
const SKIP_DIRS = new Set(['node_modules']);

function isSkippedDir(name) {
  if (name.startsWith('.')) return true;
  if (SKIP_DIRS.has(name)) return true;
  return false;
}

async function walkRoot(root) {
  const entries = [];
  async function recurse(dir) {
    if (entries.length >= MAX_FILES_PER_ROOT) return;
    let children;
    try {
      children = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const child of children) {
      if (entries.length >= MAX_FILES_PER_ROOT) return;
      if (child.isDirectory()) {
        if (isSkippedDir(child.name)) continue;
        await recurse(path.join(dir, child.name));
      } else if (child.isFile()) {
        if (!child.name.endsWith('.md')) continue;
        const absolutePath = path.join(dir, child.name);
        let stat;
        try {
          stat = await fs.stat(absolutePath);
        } catch {
          continue;
        }
        entries.push({
          rootId: root.id,
          absolutePath,
          relativePath: path.relative(root.path, absolutePath),
          mtime: stat.mtimeMs,
          size: stat.size
        });
      }
    }
  }
  await recurse(root.path);
  return entries;
}

module.exports = { walkRoot, MAX_FILES_PER_ROOT };
