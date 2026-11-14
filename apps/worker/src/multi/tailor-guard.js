function flat(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function resumeToText(resume) {
  const lines = [resume.name, resume.contact_line, resume.headline, resume.summary];
  lines.push(...(resume.highlights || []));
  for (const group of resume.skills || []) lines.push(`${group.label}: ${(group.items || []).join(", ")}`);
  for (const job of resume.experience || []) {
    lines.push(`${job.company} | ${job.location}`, `${job.title} | ${job.dates}`, ...(job.bullets || []));
  }
  lines.push(...(resume.education || []), ...(resume.extras || []));
  return lines.filter(Boolean).join("\n");
}

/** Returns human-readable problems; an empty list means the tailored resume stays truthful to the base. */
function verifyTailoredResume(resume, baseText) {
  const base = flat(baseText);
  const problems = [];
  if (!resume?.experience?.length) problems.push("No work experience in tailored resume");

  for (const job of resume?.experience || []) {
    for (const [field, value] of [["company", job.company], ["title", job.title], ["dates", job.dates]]) {
      if (value && !base.includes(flat(value))) problems.push(`Experience ${field} not in base resume: ${value}`);
    }
  }

  const baseNumbers = new Set(String(baseText || "").match(/\d+/g) || []);
  const invented = new Set();
  for (const n of resumeToText(resume || {}).match(/\d+/g) || []) {
    if (!baseNumbers.has(n)) invented.add(n);
  }
  if (invented.size) problems.push(`Numbers not in base resume: ${[...invented].join(", ")}`);
  return problems;
}

function safePart(text) {
  return String(text || "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function resumeFileName(name, company, title) {
  return `${safePart(name)}_Resume_${safePart(company)}_${safePart(title)}.pdf`;
}

module.exports = { verifyTailoredResume, resumeToText, resumeFileName, safePart };
