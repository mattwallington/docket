const TASK_LINE_RE = /^(\s*-\s+\[)([x ])(\]\s+\*\*[^*]+\*\*.*)$/;

function toggleCheckboxInBody(body, lineIndex, completed) {
  if (typeof lineIndex !== 'number' || lineIndex < 0) {
    throw new Error(`lineIndex out of range: ${lineIndex}`);
  }
  const lines = body.split('\n');
  let count = 0;
  let foundIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (TASK_LINE_RE.test(line)) {
      if (count === lineIndex) {
        foundIdx = i;
        break;
      }
      count++;
    }
  }
  if (foundIdx === -1) {
    throw new Error(`lineIndex out of range: ${lineIndex}`);
  }
  const target = completed ? 'x' : ' ';
  const hasCR = lines[foundIdx].endsWith('\r');
  const cleanLine = hasCR ? lines[foundIdx].slice(0, -1) : lines[foundIdx];
  const replaced = cleanLine.replace(TASK_LINE_RE, (_, p1, _p2, p3) => p1 + target + p3);
  lines[foundIdx] = hasCR ? replaced + '\r' : replaced;
  return lines.join('\n');
}

module.exports = { toggleCheckboxInBody };
