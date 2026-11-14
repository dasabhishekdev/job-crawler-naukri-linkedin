const KEYS = new Set(["Enter", "Backspace", "Tab", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Delete", "Home", "End"]);
const MAX_TEXT = 500;
const MAX_SCROLL = 1500;

function inBounds(x, y, viewport) {
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= viewport.width && y <= viewport.height;
}

/** Normalises one input message from the login window, or returns null when it is not allowed. */
function validateInput(msg, viewport) {
  if (!msg || typeof msg !== "object") return null;
  switch (msg.t) {
    case "tap": {
      const x = Number(msg.x);
      const y = Number(msg.y);
      return inBounds(x, y, viewport) ? { t: "tap", x, y } : null;
    }
    case "scroll": {
      const x = Number(msg.x);
      const y = Number(msg.y);
      const dy = Math.max(-MAX_SCROLL, Math.min(MAX_SCROLL, Number(msg.dy) || 0));
      return inBounds(x, y, viewport) && dy ? { t: "scroll", x, y, dy } : null;
    }
    case "text":
      return typeof msg.text === "string" && msg.text.length > 0 && msg.text.length <= MAX_TEXT ? { t: "text", text: msg.text } : null;
    case "key":
      return KEYS.has(msg.key) ? { t: "key", key: msg.key } : null;
    case "back":
    case "reload":
      return { t: msg.t };
    default:
      return null;
  }
}

module.exports = { validateInput, KEYS };
