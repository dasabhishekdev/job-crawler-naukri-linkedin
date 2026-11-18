/** Page / description text that strongly indicates the role is no longer open. */
const EXPIRED_PATTERNS = [
  /\bno longer\s+(accepting|available|open)\b/i,
  /\b(job|position|role|posting)\s+(has\s+been\s+)?(closed|filled|expired|removed|taken down)\b/i,
  /\b(this\s+)?(job|position|role)\s+is\s+(no\s+longer\s+available|closed|filled|expired)\b/i,
  /\bapplications?\s+(are\s+)?(closed|no\s+longer\s+accepted)\b/i,
  /\b(position|role)\s+has\s+been\s+filled\b/i,
  /\bexpired\s+on\b/i,
  /\bapplication\s+deadline\s+(has\s+)?passed\b/i,
  /\b(sorry[,.]?\s+)?this\s+(job|posting)\s+(is\s+)?(no\s+longer|not)\s+available\b/i,
  /\b404\b.*\b(job|position)\b/i,
  /\b(hiring\s+for\s+this\s+role\s+is\s+complete|we('ve| have)\s+filled\s+this\s+role)\b/i,
  // Naukri / portal empty-state copy when the posting is gone
  /\bsorry\b[\s\S]{0,80}\bno\s+jobs?\s+found\b/i,
  /\bno\s+jobs?\s+found\b/i,
  /\bwe\s+couldn['’]?t\s+find\s+(this\s+)?(job|opening|posting)\b/i,
  /\b(job|opening|posting)\s+you\s+are\s+looking\s+for\s+(is\s+)?(not\s+available|no\s+longer)\b/i,
  /\bthis\s+job\s+(is\s+)?(currently\s+)?unavailable\b/i,
  /\bpage\s+not\s+found\b/i,
  /\bjob\s+has\s+been\s+removed\b/i,
];

function looksExpiredText(text) {
  const s = String(text || "");
  if (!s.trim()) return false;
  return EXPIRED_PATTERNS.some((re) => re.test(s));
}

/** True when schema.org validThrough is in the past. */
function isPastValidThrough(value, now = new Date()) {
  if (!value) return false;
  const ts = Date.parse(String(value));
  if (Number.isNaN(ts)) return false;
  return ts < now.getTime();
}

module.exports = { looksExpiredText, isPastValidThrough, EXPIRED_PATTERNS };
