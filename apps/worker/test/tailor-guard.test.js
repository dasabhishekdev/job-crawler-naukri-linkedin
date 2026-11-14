const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyTailoredResume, resumeToText, resumeFileName } = require("../src/resume/tailor-guard");

const BASE = `Anika Bhattacharyya
10on10 Foods | Bangalore, India
Operations Manager | 07/2026 - Present
• Track customer POs across 4 production units.
Amazon India | Bangalore, India
Team Leader, Quick Commerce Transshipment | 04/2025 - 07/2026
• Managed 250+ vehicles across 35 logistics vendors; 95% on-time performance.`;

function resume(overrides = {}) {
  return {
    name: "Anika Bhattacharyya",
    contact_line: "Bangalore",
    headline: "Procurement Operations",
    summary: "Operations professional tracking purchase orders across 4 production units.",
    highlights: ["35 logistics vendors managed with 95% on-time performance"],
    skills: [{ label: "Procurement", items: ["Purchase Orders", "Vendor Management"] }],
    experience: [
      {
        company: "10on10 Foods",
        location: "Bangalore, India",
        title: "Operations Manager",
        dates: "07/2026 - Present",
        bullets: ["Tracked purchase orders (POs) across 4 production units."],
      },
    ],
    education: [],
    extras: [],
    ...overrides,
  };
}

test("accepts a rephrased resume that keeps facts", () => {
  assert.deepEqual(verifyTailoredResume(resume(), BASE), []);
});

test("rejects invented employers, titles, dates and numbers", () => {
  const bad = resume({
    highlights: ["Cut procurement cost by 18%"],
    experience: [
      { company: "Flipkart", location: "", title: "Procurement Lead", dates: "2023 - 2024", bullets: [] },
    ],
  });
  const problems = verifyTailoredResume(bad, BASE);
  assert.ok(problems.some((p) => /Flipkart/.test(p)));
  assert.ok(problems.some((p) => /Procurement Lead/.test(p)));
  assert.ok(problems.some((p) => /18/.test(p)));
});

test("resumeToText flattens every section", () => {
  const text = resumeToText(resume());
  assert.match(text, /Vendor Management/);
  assert.match(text, /Tracked purchase orders/);
});

test("resumeFileName is filesystem safe", () => {
  assert.equal(
    resumeFileName("Anika Bhattacharyya", "EY / GDS", "Procurement Analyst (P2P)"),
    "Anika_Bhattacharyya_Resume_EY_GDS_Procurement_Analyst_P2P.pdf"
  );
});
