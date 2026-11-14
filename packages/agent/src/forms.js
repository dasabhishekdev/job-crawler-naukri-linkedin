const { chatJson } = require("./openai");

function prefsBlock(prefs = {}) {
  return [
    prefs.notice_period ? `Notice period: ${prefs.notice_period}` : null,
    prefs.current_ctc ? `Current CTC: ${prefs.current_ctc}` : null,
    prefs.expected_ctc ? `Expected CTC: ${prefs.expected_ctc}` : null,
    prefs.locations ? `Preferred locations: ${prefs.locations}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function answerApplicationQuestions({
  fields,
  resumeText,
  profile,
  prefs,
  job,
  runId,
}) {
  if (!fields?.length) return [];
  if (!process.env.OPENAI_API_KEY) {
    return fields
      .map((field) => {
        const label = (field.label || field.name || "").toLowerCase();
        if (label.includes("notice") && prefs?.notice_period) {
          return { ...field, value: prefs.notice_period };
        }
        if (label.includes("current") && label.includes("ctc") && prefs?.current_ctc) {
          return { ...field, value: prefs.current_ctc };
        }
        if (label.includes("expected") && label.includes("ctc") && prefs?.expected_ctc) {
          return { ...field, value: prefs.expected_ctc };
        }
        return null;
      })
      .filter(Boolean);
  }

  const parsed = await chatJson({
    runId,
    maxTokens: 700,
    messages: [
      {
        role: "user",
        content: `Fill a Naukri job application form. Be truthful. Keep answers short.
Do not invent salary numbers. If CTC is unknown, skip that field (omit it).
Return JSON: {"answers":[{"id":"...","value":"..."}]}

Candidate: ${profile?.name || ""}
${prefsBlock(prefs)}

Resume excerpt:
${(resumeText || "").slice(0, 5000)}

Job: ${job?.job_title || ""} at ${job?.company || ""}
${(job?.description || "").slice(0, 1500)}

Fields:
${JSON.stringify(
  fields.map((f) => ({
    id: f.id,
    label: f.label,
    name: f.name,
    type: f.type,
    options: f.options || [],
  }))
)}`,
      },
    ],
  });

  const answers = Array.isArray(parsed.answers) ? parsed.answers : [];
  const byId = new Map(answers.map((a) => [String(a.id), a.value]));
  return fields
    .map((field) => {
      const value = byId.get(String(field.id));
      if (value === undefined || value === null || value === "") return null;
      return { ...field, value: String(value) };
    })
    .filter(Boolean);
}

module.exports = { answerApplicationQuestions };
