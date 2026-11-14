const RESUME_SHAPE =
  '{"name":"","contact_line":"phone | email | city | linkedin","headline":"","summary":"","highlights":[""],"skills":[{"label":"","items":[""]}],"experience":[{"company":"","location":"","title":"","dates":"","bullets":[""]}],"education":[""],"extras":["languages, certifications, etc."]}';

function parsePrompt(resumeText) {
  return `Extract this resume into structured data. Copy facts exactly as written; do not invent anything.

Return a JSON object:
{
  "profile": {
    "full_name": "",
    "email": "",
    "phone": "",
    "current_location": "city as written",
    "headline": "short professional headline",
    "summary": "2-3 sentence professional summary",
    "experience_years": number (total professional experience, rounded to one decimal),
    "skills": ["up to 25 concrete skills/tools from the resume"],
    "target_roles": ["6-10 job titles this person is realistically qualified for next, based on their experience (e.g. 'Procurement Analyst')"],
    "target_locations": ["the city they live in, plus other cities only if the resume says they are open to them"]
  },
  "resume": ${RESUME_SHAPE}
}

Resume:
${resumeText}`;
}

function cleanList(values, max) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((v) => String(v || "").trim())
    .filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()))
    .slice(0, max);
}

function normalizeParsed(parsed) {
  const p = parsed?.profile || {};
  return {
    profile: {
      full_name: String(p.full_name || "").slice(0, 120),
      email: String(p.email || "").slice(0, 160),
      phone: String(p.phone || "").slice(0, 40),
      current_location: String(p.current_location || "").slice(0, 120),
      headline: String(p.headline || "").slice(0, 200),
      summary: String(p.summary || "").slice(0, 1200),
      experience_years: Math.max(0, Math.min(60, Number(p.experience_years) || 0)),
      skills: cleanList(p.skills, 25),
      target_roles: cleanList(p.target_roles, 12),
      target_locations: cleanList((p.target_locations || []).map((l) => String(l || "").split(",")[0]), 6),
    },
    resume: parsed?.resume && typeof parsed.resume === "object" ? parsed.resume : null,
  };
}

module.exports = { parsePrompt, normalizeParsed, RESUME_SHAPE };
