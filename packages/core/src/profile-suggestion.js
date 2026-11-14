const FIELD_LABELS = {
  target_roles: "Target roles",
  target_locations: "Cities to search",
  skills: "Key skills",
  experience_years: "Years of experience",
  headline: "Headline",
  summary: "Summary",
  full_name: "Full name",
  current_location: "Current city",
  phone: "Phone",
};

const SUGGESTION_FIELDS = Object.keys(FIELD_LABELS);
const LIST_FIELDS = new Set(["target_roles", "target_locations", "skills"]);

const CITY_ALIASES = {
  bangalore: "bengaluru",
  bombay: "mumbai",
  gurgaon: "gurugram",
  calcutta: "kolkata",
  madras: "chennai",
  cochin: "kochi",
  trivandrum: "thiruvananthapuram",
  baroda: "vadodara",
  mysore: "mysuru",
};

const norm = (v) => {
  const text = String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return CITY_ALIASES[text] || text;
};

function isEmpty(value) {
  return value === undefined || value === null || value === "" || value === 0 || (Array.isArray(value) && !value.length);
}

function listDiff(current = [], suggested = []) {
  const have = new Set(current.map(norm));
  const want = new Set(suggested.map(norm));
  return {
    added: suggested.filter((s) => !have.has(norm(s))),
    removed: current.filter((c) => !want.has(norm(c))),
  };
}

/** Field-by-field differences between the current profile and an AI-suggested one (empty suggestions are ignored). */
function suggestionChanges(current, suggested) {
  if (!suggested) return [];
  const changes = [];
  for (const field of SUGGESTION_FIELDS) {
    const next = suggested[field];
    if (isEmpty(next)) continue;
    const now = current?.[field];
    if (LIST_FIELDS.has(field)) {
      const { added, removed } = listDiff(now || [], next);
      if (added.length) {
        changes.push({ field, label: FIELD_LABELS[field], list: true, current: now || [], suggested: next, added, removed });
      }
    } else if (field === "experience_years" ? Number(now) !== Number(next) : norm(now) !== norm(next)) {
      changes.push({ field, label: FIELD_LABELS[field], list: false, current: now ?? "", suggested: next });
    }
  }
  return changes;
}

/** Returns the profile fields to save. `choices` maps field → "replace" | "add" (lists only). */
function applySuggestion(current, suggested, choices) {
  const patch = {};
  for (const [field, mode] of Object.entries(choices || {})) {
    if (!SUGGESTION_FIELDS.includes(field) || isEmpty(suggested?.[field])) continue;
    if (LIST_FIELDS.has(field) && mode === "add") {
      patch[field] = [...(current?.[field] || []), ...listDiff(current?.[field] || [], suggested[field]).added];
    } else {
      patch[field] = suggested[field];
    }
  }
  return patch;
}

module.exports = { suggestionChanges, applySuggestion, SUGGESTION_FIELDS, FIELD_LABELS };
