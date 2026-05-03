const path = require('path');

const MD_EXTENSIONS = new Set(['.md', '.markdown']);

function resolveOpenRequest(input, cfg, { cwd } = {}) {
  if (!input || typeof input !== 'string') throw new Error('Invalid path');
  const absolutePath = path.isAbsolute(input)
    ? path.resolve(input)
    : path.resolve(cwd || process.cwd(), input);
  const ext = path.extname(absolutePath).toLowerCase();
  if (!MD_EXTENSIONS.has(ext)) throw new Error(`Not a markdown file: ${absolutePath}`);

  const inRoot = (cfg.roots || []).some((r) => {
    const rootAbs = path.resolve(r.path);
    return absolutePath === rootAbs || absolutePath.startsWith(rootAbs + path.sep);
  });

  return {
    absolutePath,
    inRoot,
    parentDir: path.dirname(absolutePath)
  };
}

module.exports = { resolveOpenRequest };
