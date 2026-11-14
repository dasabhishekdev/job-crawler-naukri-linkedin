const EMAIL_REGEX =
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const OBFUSCATED_PATTERNS = [
  /([a-zA-Z0-9._%+-]+)\s*(?:\[at\]|@|\(at\)|\bat\b)\s*([a-zA-Z0-9.-]+)\s*(?:\[dot\]|\.|\(dot\)|\bdot\b)\s*([a-zA-Z]{2,})/gi,
  /([a-zA-Z0-9._%+-]+)\s*@\s*([a-zA-Z0-9.-]+)\s*\.\s*([a-zA-Z]{2,})/g,
];

function normalizeObfuscated(text) {
  let normalized = text;
  for (const pattern of OBFUSCATED_PATTERNS) {
    normalized = normalized.replace(pattern, "$1@$2.$3");
  }
  return normalized;
}

function extractEmails(text) {
  if (!text) return [];

  const normalized = normalizeObfuscated(text);
  const matches = normalized.match(EMAIL_REGEX) || [];

  const filtered = matches.filter((email) => {
    const lower = email.toLowerCase();
    return (
      !lower.endsWith(".png") &&
      !lower.endsWith(".jpg") &&
      !lower.includes("linkedin.com") &&
      !lower.includes("example.com")
    );
  });

  return [...new Set(filtered.map((e) => e.toLowerCase()))];
}

module.exports = { extractEmails };
