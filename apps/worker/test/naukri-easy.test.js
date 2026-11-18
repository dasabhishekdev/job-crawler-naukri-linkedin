const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { SessionExpiredError } = require("../src/portals/common");
const { detectApplyOutcome, isNaukriHost, helpReasonFromText } = require("../src/apply/detect");
const {
  applyNaukriEasy,
  isEasyApplyLabel,
  isCompanySiteLabel,
  isComplexApplyForm,
  decideNaukriApply,
} = require("../src/apply/naukri-easy");

const NAUKRI = "https://www.naukri.com/job-listings-x";

describe("detectApplyOutcome", () => {
  it("detects applied and needs_help from Naukri copy", () => {
    assert.equal(detectApplyOutcome("Application sent successfully", "https://www.naukri.com/x"), "applied");
    assert.equal(detectApplyOutcome("Please enter OTP", "https://www.naukri.com/x"), "needs_help");
  });

  it("matches applied fixtures case-insensitively", () => {
    assert.equal(detectApplyOutcome("APPLIED SUCCESSFULLY", NAUKRI), "applied");
    assert.equal(detectApplyOutcome("You have already applied to this job", NAUKRI), "applied");
    assert.equal(detectApplyOutcome("Already applied", NAUKRI), "applied");
    assert.equal(detectApplyOutcome("Your application sent.", NAUKRI), "applied");
  });

  it("matches needs_help fixtures", () => {
    assert.equal(detectApplyOutcome("Please complete the captcha", NAUKRI), "needs_help");
    assert.equal(detectApplyOutcome("Enter the OTP sent to your phone", NAUKRI), "needs_help");
    assert.equal(detectApplyOutcome("Verify mobile number to continue", NAUKRI), "needs_help");
    assert.equal(detectApplyOutcome("Unusual activity detected", NAUKRI), "needs_help");
    assert.equal(detectApplyOutcome("Security checkpoint required", NAUKRI), "needs_help");
  });

  it("returns unknown when page text is inconclusive", () => {
    assert.equal(detectApplyOutcome("Senior Engineer at Acme. Apply from this job page.", NAUKRI), "unknown");
    assert.equal(detectApplyOutcome("", NAUKRI), "unknown");
  });

  it("prefers applied when success copy is present", () => {
    assert.equal(detectApplyOutcome("Application sent. Please ignore leftover captcha widget.", NAUKRI), "applied");
  });
});

describe("isNaukriHost and helpReasonFromText", () => {
  it("accepts naukri hosts only", () => {
    assert.equal(isNaukriHost("https://www.naukri.com/job-listings-1"), true);
    assert.equal(isNaukriHost("https://www.naukri.com/mnjuser/apply"), true);
    assert.equal(isNaukriHost("https://company.careers/apply"), false);
    assert.equal(isNaukriHost("not-a-url"), false);
  });

  it("maps help copy to a reason", () => {
    assert.equal(helpReasonFromText("Solve this captcha"), "captcha");
    assert.equal(helpReasonFromText("Please enter OTP"), "otp");
    assert.equal(helpReasonFromText("Verify mobile to continue"), "otp");
    assert.equal(helpReasonFromText("Unusual activity on your account"), "checkpoint");
  });
});

describe("Easy Apply button labels", () => {
  it("prefers Easy Apply / Apply now and rejects company-site apply", () => {
    assert.equal(isEasyApplyLabel("Easy Apply"), true);
    assert.equal(isEasyApplyLabel("Apply now"), true);
    assert.equal(isEasyApplyLabel("Apply"), true);
    assert.equal(isEasyApplyLabel("APPLY"), true);
    assert.equal(isEasyApplyLabel("Apply on company site"), false);
    assert.equal(isEasyApplyLabel("Apply on company website"), false);
    assert.equal(isCompanySiteLabel("Apply on company site"), true);
    assert.equal(isEasyApplyLabel("Save"), false);
    assert.equal(isEasyApplyLabel("Applying"), false);
  });
});

describe("isComplexApplyForm", () => {
  it("flags chatbot or required free-text in a modal fixture", () => {
    assert.equal(isComplexApplyForm("Hi, I'm the Naukri assistant. Let's chat about this role."), true);
    assert.equal(
      isComplexApplyForm("Please answer the following question", '<div role="dialog"><textarea required name="cover"></textarea></div>'),
      true
    );
    assert.equal(isComplexApplyForm("Application sent successfully", "<div>toast</div>"), false);
  });
});

describe("decideNaukriApply", () => {
  it("returns ok when already applied before a click", () => {
    assert.deepEqual(decideNaukriApply({ bodyText: "You have already applied", url: NAUKRI, buttonLabels: ["Apply"] }), { ok: true });
  });

  it("asks to click Easy Apply when the page is ready", () => {
    assert.deepEqual(
      decideNaukriApply({
        bodyText: "Senior Engineer at Acme",
        url: NAUKRI,
        buttonLabels: ["Save", "Apply on company site", "Apply now"],
      }),
      { action: "click", label: "Apply now" }
    );
  });

  it("needs help for company-site-only jobs", () => {
    assert.deepEqual(
      decideNaukriApply({ bodyText: "Apply from the employer site", url: NAUKRI, buttonLabels: ["Apply on company site"] }),
      { ok: false, needsHelp: true, reason: "not_easy_apply" }
    );
  });

  it("needs help after click when URL leaves Naukri", () => {
    assert.deepEqual(
      decideNaukriApply({
        bodyText: "Welcome to Acme Careers",
        url: "https://jobs.acme.com/apply",
        buttonLabels: [],
        applyClicked: true,
      }),
      { ok: false, needsHelp: true, reason: "external_apply", attempted: true }
    );
  });

  it("needs help for complex chat/questions after click", () => {
    assert.deepEqual(
      decideNaukriApply({
        bodyText: "Tell us why you are a fit",
        url: NAUKRI,
        applyClicked: true,
        modalText: "Required question",
        modalHtml: '<form><textarea required></textarea></form>',
      }),
      { ok: false, needsHelp: true, reason: "complex_form", attempted: true }
    );
  });

  it("returns applied after a one-click confirm", () => {
    assert.deepEqual(
      decideNaukriApply({
        bodyText: "Application sent successfully",
        url: NAUKRI,
        applyClicked: true,
      }),
      { ok: true, attempted: true }
    );
  });

  it("needs help on OTP after click", () => {
    assert.deepEqual(
      decideNaukriApply({
        bodyText: "Please enter OTP",
        url: NAUKRI,
        applyClicked: true,
      }),
      { ok: false, needsHelp: true, reason: "otp", attempted: true }
    );
  });

  it("does not re-click leftover Apply now when there is no confirm modal", () => {
    assert.deepEqual(
      decideNaukriApply({
        bodyText: "Senior Engineer at Acme",
        url: NAUKRI,
        buttonLabels: ["Save", "Apply now"],
        applyClicked: true,
      }),
      { ok: false, failed: true, reason: "unknown_outcome", attempted: true }
    );
  });

  it("confirms a modal Submit after Easy Apply", () => {
    assert.deepEqual(
      decideNaukriApply({
        bodyText: "Review application",
        url: NAUKRI,
        buttonLabels: ["Apply now", "Submit"],
        applyClicked: true,
        modalText: "Review application",
      }),
      { action: "confirm", label: "Submit", attempted: true }
    );
  });
});

describe("applyNaukriEasy", () => {
  it("throws SessionExpiredError on a Naukri login wall", async () => {
    const page = {
      url: () => "https://www.naukri.com/nlogin/login",
      goto: async () => {},
      waitForLoadState: async () => {},
      locator: () => ({ innerText: async () => "Login to apply" }),
    };
    await assert.rejects(() => applyNaukriEasy({ page, jobUrl: NAUKRI }), (err) => {
      assert.equal(err.name, "SessionExpiredError");
      assert.equal(err.portal, "naukri");
      assert.ok(err instanceof SessionExpiredError);
      return true;
    });
  });
});
