const fs = require('fs');
const path = require('path');

const targets = [
  {
    src: path.resolve(__dirname, '../node_modules/marked/marked.min.js'),
    dst: path.resolve(__dirname, '../renderer/vendor/marked.min.js')
  },
  {
    src: path.resolve(__dirname, '../node_modules/dompurify/dist/purify.min.js'),
    dst: path.resolve(__dirname, '../renderer/vendor/purify.min.js')
  },
  {
    src: path.resolve(__dirname, '../node_modules/@highlightjs/cdn-assets/highlight.min.js'),
    dst: path.resolve(__dirname, '../renderer/vendor/highlight.min.js')
  },
  {
    src: path.resolve(__dirname, '../node_modules/@highlightjs/cdn-assets/styles/atom-one-dark.min.css'),
    dst: path.resolve(__dirname, '../renderer/vendor/highlight.css')
  }
];

fs.mkdirSync(path.resolve(__dirname, '../renderer/vendor'), { recursive: true });

for (const { src, dst } of targets) {
  if (!fs.existsSync(src)) {
    console.warn(`[copy-vendor] source missing: ${src}`);
    process.exit(0);
  }
  fs.copyFileSync(src, dst);
  console.log(`[copy-vendor] ${path.relative(path.resolve(__dirname, '..'), dst)}`);
}
