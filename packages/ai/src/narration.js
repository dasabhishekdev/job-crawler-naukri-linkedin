const MIN_LEN = 12;
const MAX_LEN = 240;
const JSON_START = /```|^\s*[[{]|"\w+"\s*:/;
const SENTENCE_END = /([.!?])(\s+|$)|\n+/;

/**
 * Turns streamed assistant text chunks into short, readable narration lines.
 * Stops at the first sign of the JSON answer and emits at most `max` lines.
 */
function createNarrator(emit, { max = 25 } = {}) {
  let buffer = "";
  let done = false;
  let count = 0;

  function take(sentence) {
    const line = sentence.replace(/\s+/g, " ").trim();
    if (JSON_START.test(line)) {
      done = true;
      return;
    }
    if (line.length < MIN_LEN || count >= max) return;
    count++;
    emit(line.length > MAX_LEN ? `${line.slice(0, MAX_LEN)}…` : line);
  }

  return {
    push(chunk) {
      if (done || typeof chunk !== "string") return;
      buffer += chunk;
      if (JSON_START.test(buffer)) {
        const idx = buffer.search(JSON_START);
        const before = buffer.slice(0, idx);
        buffer = "";
        if (before.trim()) take(before);
        done = true;
        return;
      }
      let match = buffer.match(SENTENCE_END);
      while (match && !done) {
        const end = match.index + match[0].length;
        take(buffer.slice(0, match.index + (match[1] ? 1 : 0)));
        buffer = buffer.slice(end);
        match = buffer.match(SENTENCE_END);
      }
    },
    flush() {
      if (!done && buffer.trim()) take(buffer);
      buffer = "";
    },
  };
}

module.exports = { createNarrator };
