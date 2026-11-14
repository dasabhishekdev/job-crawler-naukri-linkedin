function stripFences(text) {
  return String(text || "").replace(/```(?:json)?/gi, "");
}

function extractJsonArray(text) {
  const raw = stripFences(text);
  const chunks = [];
  const arrStart = raw.indexOf("[");
  const objStart = raw.indexOf("{");
  if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) chunks.push(raw.slice(objStart, raw.lastIndexOf("}") + 1));
  if (arrStart >= 0) chunks.push(raw.slice(arrStart, raw.lastIndexOf("]") + 1));

  for (const chunk of chunks) {
    try {
      const parsed = JSON.parse(chunk);
      if (Array.isArray(parsed)) return parsed;
      for (const key of ["jobs", "results", "items", "postings"]) {
        if (Array.isArray(parsed?.[key])) return parsed[key];
      }
    } catch {
      /* try the next candidate */
    }
  }
  return [];
}

function extractJsonObject(text) {
  const raw = stripFences(text);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The AI reply did not contain JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

module.exports = { extractJsonArray, extractJsonObject };
