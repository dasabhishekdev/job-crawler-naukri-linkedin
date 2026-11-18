const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { SessionExpiredError } = require("../src/portals/common");
const { detectApplyOutcome, helpReasonFromText } = require("../src/apply/detect");
const {
  applyLinkedInEasy,
  isEasyApplyLabel,
  isExternalApplyLabel,
  isAdvanceLabel,
  isLinkedInSuccess,
  mapFieldFromVault,
  planLinkedInStep,
} = require("../src/apply/linkedin-easy");

const LI = "https://www.linkedin.com/jobs/view/4012345678/";
const VAULT = { email: "a@b.com", phone: "9991112222", current_location: "Bengaluru" };

describe("LinkedIn success / help detectors", () => {
  it("matches Easy Apply success copy from the brief", () => {
    assert.equal(isLinkedInSuccess("Application submitted"), true);
    assert.equal(isLinkedInSuccess("Your application was sent to Acme"), true);
    assert.equal(isLinkedInSuccess("Done", { successModal: true }), true);
    assert.equal(isLinkedInSuccess("Senior Engineer at Acme. Easy Apply."), false);
  });

  it("reuses detectApplyOutcome for captcha and checkpoint", () => {
    assert.equal(detectApplyOutcome("Please complete the captcha", LI), "needs_help");
    assert.equal(detectApplyOutcome("Security checkpoint required", LI), "needs_help");
    assert.equal(detectApplyOutcome("Job details", "https://www.linkedin.com/checkpoint/challenge"), "needs_help");
    assert.equal(helpReasonFromText("Please complete the captcha"), "captcha");
    assert.equal(helpReasonFromText("Unusual activity detected"), "checkpoint");
  });
});

describe("Easy Apply vs external Apply labels", () => {
  it("treats Easy Apply as in-product and Apply as external", () => {
    assert.equal(isEasyApplyLabel("Easy Apply"), true);
    assert.equal(isEasyApplyLabel("Easy apply"), true);
    assert.equal(isEasyApplyLabel("Easy Apply to Engineer at Acme"), true);
    assert.equal(isEasyApplyLabel("Apply"), false);
    assert.equal(isEasyApplyLabel("APPLY"), false);
    assert.equal(isEasyApplyLabel("Apply on company website"), false);
    assert.equal(isEasyApplyLabel("Save"), false);
    assert.equal(isExternalApplyLabel("Apply"), true);
    assert.equal(isExternalApplyLabel("Apply on company website"), true);
    assert.equal(isExternalApplyLabel("Easy Apply"), false);
  });

  it("recognizes Next / Review / Submit as advance controls", () => {
    assert.equal(isAdvanceLabel("Next"), true);
    assert.equal(isAdvanceLabel("Review"), true);
    assert.equal(isAdvanceLabel("Submit"), true);
    assert.equal(isAdvanceLabel("Submit application"), true);
    assert.equal(isAdvanceLabel("Done"), false);
    assert.equal(isAdvanceLabel("Easy Apply"), false);
  });
});

describe("mapFieldFromVault", () => {
  it("maps email, phone, and city from the vault", () => {
    assert.equal(mapFieldFromVault({ name: "email", label: "Email", type: "email" }, VAULT), "a@b.com");
    assert.equal(mapFieldFromVault({ name: "phoneNumber", label: "Mobile phone number", type: "tel" }, VAULT), "9991112222");
    assert.equal(mapFieldFromVault({ name: "city", label: "City", type: "text" }, VAULT), "Bengaluru");
    assert.equal(mapFieldFromVault({ name: "location", label: "Current location", type: "text" }, VAULT), "Bengaluru");
  });

  it("does not map other Phase 1 fields even when the vault has extra data", () => {
    const vault = { ...VAULT, full_name: "Ada Lovelace", expected_ctc: "30 LPA" };
    assert.equal(mapFieldFromVault({ name: "firstName", label: "First name", type: "text" }, vault), null);
    assert.equal(mapFieldFromVault({ name: "expectedCtc", label: "Expected CTC", type: "text" }, vault), null);
    assert.equal(mapFieldFromVault({ name: "headline", label: "Headline", type: "text" }, vault), null);
  });
});

describe("planLinkedInStep", () => {
  it("returns ok when already applied before a click", () => {
    assert.deepEqual(
      planLinkedInStep({ bodyText: "You have already applied", url: LI, buttonLabels: ["Easy Apply"] }),
      { ok: true }
    );
  });

  it("returns ok when LinkedIn shows Applied / you applied on", () => {
    assert.equal(isLinkedInSuccess("You applied on November 1"), true);
    assert.deepEqual(
      planLinkedInStep({ bodyText: "Senior Engineer at Acme", url: LI, buttonLabels: ["Save", "Applied"] }),
      { ok: true }
    );
  });

  it("clicks Easy Apply when the job page is ready", () => {
    assert.deepEqual(
      planLinkedInStep({
        bodyText: "Senior Engineer at Acme",
        url: LI,
        buttonLabels: ["Save", "Easy Apply"],
      }),
      { action: "click_easy_apply", label: "Easy Apply" }
    );
  });

  it("needs help when only an external Apply button exists", () => {
    assert.deepEqual(
      planLinkedInStep({
        bodyText: "Apply on the company site",
        url: LI,
        buttonLabels: ["Save", "Apply"],
      }),
      { ok: false, needsHelp: true, reason: "not_easy_apply" }
    );
  });

  it("fails when no apply control is present", () => {
    assert.deepEqual(
      planLinkedInStep({ bodyText: "Senior Engineer at Acme", url: LI, buttonLabels: ["Save"] }),
      { ok: false, failed: true, reason: "no_apply_button" }
    );
  });

  it("needs help on captcha before clicking", () => {
    assert.deepEqual(
      planLinkedInStep({ bodyText: "Please complete the captcha", url: LI, buttonLabels: ["Easy Apply"] }),
      { ok: false, needsHelp: true, reason: "captcha" }
    );
  });

  it("returns applied after submit success copy", () => {
    assert.deepEqual(
      planLinkedInStep({
        bodyText: "Application submitted",
        url: LI,
        easyApplyClicked: true,
      }),
      { ok: true, attempted: true }
    );
  });

  it("returns applied for a dismissible Done success modal", () => {
    assert.deepEqual(
      planLinkedInStep({
        bodyText: "Done",
        url: LI,
        buttonLabels: ["Done"],
        easyApplyClicked: true,
        successModal: true,
      }),
      { ok: true, attempted: true }
    );
  });

  it("needs help on captcha or on-page checkpoint after Easy Apply", () => {
    assert.deepEqual(
      planLinkedInStep({
        bodyText: "Please complete the captcha",
        url: LI,
        easyApplyClicked: true,
      }),
      { ok: false, needsHelp: true, reason: "captcha", attempted: true }
    );
    assert.deepEqual(
      planLinkedInStep({
        bodyText: "Unusual activity detected",
        url: LI,
        easyApplyClicked: true,
      }),
      { ok: false, needsHelp: true, reason: "checkpoint", attempted: true }
    );
  });

  it("throws SessionExpiredError when the URL hits login, authwall, or checkpoint mid-flow", () => {
    for (const url of [
      "https://www.linkedin.com/login",
      "https://www.linkedin.com/authwall?trk=x",
      "https://www.linkedin.com/checkpoint/challenge",
      "https://www.linkedin.com/uas/login",
    ]) {
      assert.throws(
        () => planLinkedInStep({ bodyText: "Sign in", url, easyApplyClicked: true }),
        (err) => {
          assert.equal(err.name, "SessionExpiredError");
          assert.equal(err.portal, "linkedin");
          assert.ok(err instanceof SessionExpiredError);
          return true;
        }
      );
    }
  });

  it("uploads a resume when a file input is visible and resumePath is set", () => {
    assert.deepEqual(
      planLinkedInStep({
        bodyText: "Upload resume",
        url: LI,
        easyApplyClicked: true,
        fileInputVisible: true,
        resumePath: "/tmp/resume.pdf",
        vault: VAULT,
      }),
      { action: "upload" }
    );
  });

  it("fills empty email, phone, and city from the vault", () => {
    assert.deepEqual(
      planLinkedInStep({
        bodyText: "Contact info",
        url: LI,
        easyApplyClicked: true,
        vault: VAULT,
        fields: [
          { name: "email", label: "Email", type: "email", empty: true },
          { name: "phoneNumber", label: "Phone", type: "tel", empty: true },
          { name: "city", label: "City", type: "text", empty: true },
        ],
        buttonLabels: [{ label: "Next", enabled: true }],
      }),
      {
        action: "fill",
        fills: [
          { name: "email", label: "Email", value: "a@b.com" },
          { name: "phoneNumber", label: "Phone", value: "9991112222" },
          { name: "city", label: "City", value: "Bengaluru" },
        ],
      }
    );
  });

  it("needs help for an unmapped required field after fill attempt", () => {
    assert.deepEqual(
      planLinkedInStep({
        bodyText: "Additional questions",
        url: LI,
        easyApplyClicked: true,
        vault: VAULT,
        fields: [
          { name: "email", label: "Email", type: "email", empty: false },
          { name: "firstName", label: "First name", type: "text", required: true, empty: true },
        ],
        buttonLabels: [{ label: "Next", enabled: false }],
      }),
      { ok: false, needsHelp: true, reason: "unmapped_field", attempted: true }
    );
  });

  it("needs help when a required file input has no resumePath", () => {
    assert.deepEqual(
      planLinkedInStep({
        bodyText: "Upload resume",
        url: LI,
        easyApplyClicked: true,
        fileInputVisible: true,
        fileInputRequired: true,
        vault: VAULT,
      }),
      { ok: false, needsHelp: true, reason: "unmapped_field", attempted: true }
    );
  });

  it("needs help for a required checkbox that Phase 1 cannot fill", () => {
    assert.deepEqual(
      planLinkedInStep({
        bodyText: "Work authorization",
        url: LI,
        easyApplyClicked: true,
        vault: VAULT,
        fields: [
          { name: "authorized", label: "Are you authorized to work?", type: "checkbox", required: true, empty: true },
        ],
        buttonLabels: [{ label: "Review", enabled: false }],
      }),
      { ok: false, needsHelp: true, reason: "unmapped_field", attempted: true }
    );
  });

  it("needs help when a remaining field is aria-invalid", () => {
    assert.deepEqual(
      planLinkedInStep({
        bodyText: "Please fix the highlighted fields",
        url: LI,
        easyApplyClicked: true,
        vault: VAULT,
        fields: [{ name: "years", label: "Years of experience", type: "text", required: true, empty: true, ariaInvalid: true }],
        buttonLabels: [{ label: "Review", enabled: false }],
      }),
      { ok: false, needsHelp: true, reason: "unmapped_field", attempted: true }
    );
  });

  it("advances when Next / Review / Submit is enabled and required fields are filled", () => {
    assert.deepEqual(
      planLinkedInStep({
        bodyText: "Contact info",
        url: LI,
        easyApplyClicked: true,
        vault: VAULT,
        fields: [{ name: "email", label: "Email", type: "email", empty: false }],
        buttonLabels: [{ label: "Next", enabled: true }],
      }),
      { action: "next", label: "Next" }
    );
    assert.deepEqual(
      planLinkedInStep({
        bodyText: "Review your application",
        url: LI,
        easyApplyClicked: true,
        buttonLabels: [{ label: "Submit", enabled: true }],
      }),
      { action: "next", label: "Submit" }
    );
  });

  it("does not re-click Easy Apply after the modal is open", () => {
    assert.deepEqual(
      planLinkedInStep({
        bodyText: "Senior Engineer at Acme",
        url: LI,
        buttonLabels: ["Easy Apply", "Save"],
        easyApplyClicked: true,
      }),
      { ok: false, failed: true, reason: "unknown_outcome", attempted: true }
    );
  });
});

describe("applyLinkedInEasy", () => {
  it("throws SessionExpiredError on a LinkedIn login wall", async () => {
    const page = {
      url: () => "https://www.linkedin.com/login",
      goto: async () => {},
      waitForLoadState: async () => {},
      locator: () => ({ innerText: async () => "Sign in" }),
    };
    await assert.rejects(() => applyLinkedInEasy({ page, jobUrl: LI, vault: VAULT }), (err) => {
      assert.equal(err.name, "SessionExpiredError");
      assert.equal(err.portal, "linkedin");
      assert.ok(err instanceof SessionExpiredError);
      return true;
    });
  });
});
