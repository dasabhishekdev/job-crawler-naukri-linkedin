const { chatJson } = require("./openai");

async function generateHeadline({ resumeText, profile, runId }) {
  const fallback = `${profile?.target_roles?.[0] || "Professional"} | ${(profile?.skills || [])
    .slice(0, 3)
    .join(" | ")}`.slice(0, 120);

  if (!process.env.OPENAI_API_KEY) return fallback;

  try {
    const parsed = await chatJson({
      runId,
      maxTokens: 160,
      messages: [
        {
          role: "user",
          content: `Write a Naukri profile headline (max 120 characters) for this candidate.
Slightly vary wording so a twice-daily save still looks fresh, but keep it truthful.
JSON only: {"headline":"..."}

Name: ${profile?.name || ""}
Target roles: ${(profile?.target_roles || []).join(", ")}
Skills: ${(profile?.skills || []).slice(0, 12).join(", ")}

Resume excerpt:
${(resumeText || "").slice(0, 3000)}`,
        },
      ],
    });
    const headline = String(parsed.headline || fallback).replace(/\s+/g, " ").trim();
    return headline.slice(0, 120) || fallback;
  } catch {
    return fallback;
  }
}

module.exports = { generateHeadline };
