const SYNONYMS = {
  "purchase order": ["po", "pos", "purchase orders"],
  "purchase orders": ["po", "pos", "purchase order"],
  "goods receipt note": ["grn", "grns"],
  "goods receipt": ["grn", "grns"],
  "procure to pay": ["p2p"],
  p2p: ["procure to pay"],
  "microsoft excel": ["excel"],
  "ms excel": ["excel"],
  "advanced excel": ["excel"],
  "key performance indicators": ["kpi", "kpis"],
  kpi: ["kpis", "key performance indicators"],
  "service level agreement": ["sla", "slas"],
  sla: ["slas", "service level agreement"],
  "root cause analysis": ["rca"],
  rca: ["root cause analysis"],
  "fleet management": ["fleet"],
  "line haul": ["linehaul"],
  linehaul: ["line haul"],
  "supplier management": ["vendor management"],
  "vendor management": ["supplier management"],
  "supplier onboarding": ["vendor onboarding"],
  "vendor onboarding": ["supplier onboarding"],
  "stakeholder management": ["stakeholder coordination"],
  "quick commerce": ["q commerce", "qcommerce"],
  vlookup: ["xlookup"],
  "pivot tables": ["pivot table"],
};

function normalize(text) {
  return ` ${String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[-_/]/g, " ")
    .replace(/[^a-z0-9+#. ]/g, " ")
    .replace(/\.(\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function variants(keyword) {
  const base = normalize(keyword).trim();
  const out = new Set([base]);
  if (base.endsWith("ies")) out.add(`${base.slice(0, -3)}y`);
  else if (base.endsWith("es")) out.add(base.slice(0, -2));
  if (base.endsWith("s")) out.add(base.slice(0, -1));
  else out.add(`${base}s`);
  for (const syn of SYNONYMS[base] || []) out.add(normalize(syn).trim());
  return [...out].filter(Boolean);
}

function keywordPresent(keyword, normalizedResume) {
  return variants(keyword).some((v) => normalizedResume.includes(` ${v} `));
}

function atsCoverage(keywords, resumeText) {
  const unique = [];
  const seen = new Set();
  for (const k of keywords || []) {
    const key = normalize(k).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(String(k).trim());
  }
  if (!unique.length) return { score: null, matched: [], missing: [] };

  const resume = normalize(resumeText);
  const matched = [];
  const missing = [];
  for (const k of unique) (keywordPresent(k, resume) ? matched : missing).push(k);
  return { score: Math.round((matched.length / unique.length) * 100), matched, missing };
}

module.exports = { atsCoverage, keywordPresent };
