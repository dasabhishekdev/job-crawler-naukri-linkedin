const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { SessionExpiredError } = require("../src/portals/common");
const { processApplication, processQueuedApplications, attemptsTodayFilter } = require("../src/apply/orchestrator");
const { HANDLERS } = require("../src/runner");
const { autoApplyTask } = require("../src/tasks/auto-apply");

function makeApp(over = {}) {
  return {
    _id: "app1",
    user_id: "u1",
    job_id: "j1",
    status: "queued",
    portal_kind: "unknown",
    attempts: 0,
    attempt_counted: false,
    attempted_at: undefined,
    last_error: "",
    help_reason: "",
    screenshot_refs: [],
    createdAt: new Date(1),
    async save() {
      return this;
    },
    ...over,
  };
}

function makeJob(over = {}) {
  return {
    _id: "j1",
    user_id: "u1",
    source: "naukri",
    job_url: "https://www.naukri.com/job-listings-1",
    title: "Engineer",
    company: "Acme",
    status: "new",
    ...over,
  };
}

function makeBrowser() {
  const page = {
    screenshot: async () => {},
  };
  const context = {
    newPage: async () => page,
    storageState: async () => ({ cookies: [{ name: "sid" }] }),
    close: async () => {
      context.closed = true;
    },
    closed: false,
  };
  const browser = {
    newContext: async (opts) => {
      browser.lastContextOpts = opts;
      return context;
    },
  };
  return { page, context, browser };
}

function baseDeps({ job = makeJob(), connections, adapters, extra = {} } = {}) {
  const calls = { adapter: 0, refresh: 0, expired: 0, screenshots: [] };
  const { browser, context } = makeBrowser();
  const deps = {
    findJob: async () => job,
    updateJob: async (_userId, _jobId, set) => Object.assign(job, set),
    loadConnectedStates: async () => connections ?? [{ portal: "naukri", storageState: { cookies: [] } }],
    refreshConnection: async () => {
      calls.refresh += 1;
    },
    markExpired: async () => {
      calls.expired += 1;
    },
    writeResumeTemp: async () => ({ resumePath: "/tmp/resume.pdf", cleanup: async () => {} }),
    saveScreenshot: async (_page, id) => {
      const file = `/tmp/apply-screenshots/${id}.png`;
      calls.screenshots.push(file);
      return file;
    },
    adapters: adapters || {
      naukri_easy: async () => {
        calls.adapter += 1;
        return { ok: false, needsHelp: true, reason: "captcha", attempted: true };
      },
    },
    browser,
    ...extra,
  };
  return { deps, job, calls, browser, context };
}

describe("processApplication", () => {
  it("sets needs_help, counts the attempt, and stores a screenshot when the adapter asks for help", async () => {
    const application = makeApp();
    const { deps, calls, context } = baseDeps();
    await processApplication({
      application,
      user: { _id: "u1" },
      vault: { email: "a@b.com" },
      log: { info: async () => {}, warn: async () => {}, job: async () => {} },
      ...deps,
    });
    assert.equal(application.status, "needs_help");
    assert.equal(application.help_reason, "captcha");
    assert.equal(application.attempt_counted, true);
    assert.ok(application.attempted_at instanceof Date);
    assert.equal(application.attempts, 1);
    assert.deepEqual(application.screenshot_refs, ["/tmp/apply-screenshots/app1.png"]);
    assert.equal(calls.adapter, 1);
    assert.equal(calls.refresh, 0);
    assert.equal(context.closed, true);
  });

  it("marks applied, updates the job, and refreshes the portal session on success", async () => {
    const application = makeApp();
    const { deps, job, calls } = baseDeps({
      adapters: {
        naukri_easy: async ({ jobUrl, resumePath }) => {
          assert.equal(jobUrl, "https://www.naukri.com/job-listings-1");
          assert.equal(resumePath, "/tmp/resume.pdf");
          return { ok: true, attempted: true };
        },
      },
    });
    await processApplication({
      application,
      user: { _id: "u1" },
      vault: { email: "a@b.com" },
      log: { info: async () => {}, warn: async () => {}, job: async () => {} },
      ...deps,
    });
    assert.equal(application.status, "applied");
    assert.ok(application.applied_at instanceof Date);
    assert.equal(application.attempt_counted, true);
    assert.ok(application.attempted_at instanceof Date);
    assert.equal(job.status, "applied");
    assert.equal(calls.refresh, 1);
    assert.equal(application.help_reason, "");
  });

  it("fails when the job posting is missing", async () => {
    const application = makeApp();
    const { deps, calls } = baseDeps({ extra: { findJob: async () => null } });
    await processApplication({
      application,
      user: { _id: "u1" },
      vault: {},
      ...deps,
    });
    assert.equal(application.status, "failed");
    assert.match(application.last_error, /not found/i);
    assert.equal(calls.adapter, 0);
  });

  it("sets needs_help portal_disconnected when the matching session is missing", async () => {
    const application = makeApp();
    const { deps, calls } = baseDeps({ connections: [] });
    await processApplication({
      application,
      user: { _id: "u1" },
      vault: {},
      ...deps,
    });
    assert.equal(application.status, "needs_help");
    assert.equal(application.help_reason, "portal_disconnected");
    assert.equal(application.attempt_counted, false);
    assert.equal(calls.adapter, 0);
  });

  it("sets classifying portal_kind from the job source", async () => {
    const application = makeApp({ portal_kind: "unknown" });
    const { deps } = baseDeps({
      job: makeJob({ source: "linkedin", job_url: "https://www.linkedin.com/jobs/view/1" }),
      connections: [{ portal: "linkedin", storageState: {} }],
      adapters: {
        linkedin_easy: async () => ({ ok: true, attempted: false }),
      },
    });
    await processApplication({
      application,
      user: { _id: "u1" },
      vault: {},
      ...deps,
    });
    assert.equal(application.portal_kind, "linkedin_easy");
    assert.equal(application.status, "applied");
    assert.equal(application.attempt_counted, false);
  });

  it("fails unsupported portal kinds without opening a browser", async () => {
    const application = makeApp();
    let opened = false;
    const { deps } = baseDeps({
      job: makeJob({ source: "web" }),
      extra: {
        browser: {
          newContext: async () => {
            opened = true;
            throw new Error("should not open");
          },
        },
      },
    });
    await processApplication({
      application,
      user: { _id: "u1" },
      vault: {},
      ...deps,
    });
    assert.equal(application.status, "failed");
    assert.equal(application.portal_kind, "unknown");
    assert.equal(opened, false);
  });

  it("treats adapter timeout as needs_help and closes the browser context", async () => {
    const application = makeApp();
    let resolveHang;
    const hang = new Promise((resolve) => {
      resolveHang = resolve;
    });
    const { deps, context } = baseDeps({
      adapters: { naukri_easy: () => hang },
      extra: { timeoutMs: 20 },
    });
    await processApplication({
      application,
      user: { _id: "u1" },
      vault: {},
      log: { info: async () => {}, warn: async () => {}, job: async () => {} },
      ...deps,
    });
    resolveHang({ ok: true });
    assert.equal(application.status, "needs_help");
    assert.equal(application.help_reason, "timeout");
    assert.equal(application.attempt_counted, true);
    assert.ok(application.attempted_at instanceof Date);
    assert.equal(application.attempts, 1);
    assert.equal(context.closed, true);
    assert.ok(application.screenshot_refs.length);
  });

  it("counts a timeout during execute and swallows a late adapter rejection", async () => {
    const application = makeApp();
    let rejectHang;
    const hang = new Promise((_, reject) => {
      rejectHang = reject;
    });
    const { deps, context } = baseDeps({
      adapters: { naukri_easy: () => hang },
      extra: { timeoutMs: 20 },
    });
    const unhandled = [];
    const onUnhandled = (err) => unhandled.push(err);
    process.on("unhandledRejection", onUnhandled);
    try {
      await processApplication({
        application,
        user: { _id: "u1" },
        vault: {},
        log: { info: async () => {}, warn: async () => {}, job: async () => {} },
        ...deps,
      });
      rejectHang(new Error("late adapter rejection"));
      await new Promise((resolve) => setTimeout(resolve, 30));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    assert.equal(application.status, "needs_help");
    assert.equal(application.help_reason, "timeout");
    assert.equal(application.attempt_counted, true);
    assert.ok(application.attempted_at instanceof Date);
    assert.equal(application.attempts, 1);
    assert.equal(context.closed, true);
    assert.equal(unhandled.length, 0);
  });

  it("marks portal_disconnected and expires the session on SessionExpiredError", async () => {
    const application = makeApp();
    const { deps, calls } = baseDeps({
      adapters: {
        naukri_easy: async () => {
          throw new SessionExpiredError("naukri");
        },
      },
    });
    await processApplication({
      application,
      user: { _id: "u1" },
      vault: {},
      log: { info: async () => {}, warn: async () => {}, job: async () => {} },
      ...deps,
    });
    assert.equal(application.status, "needs_help");
    assert.equal(application.help_reason, "portal_disconnected");
    assert.equal(application.attempt_counted, true);
    assert.ok(application.attempted_at instanceof Date);
    assert.equal(application.attempts, 1);
    assert.equal(calls.expired, 1);
    assert.equal(calls.refresh, 0);
  });

  it("counts a generic executing error as an attempt before marking failed", async () => {
    const application = makeApp();
    const { deps } = baseDeps({
      adapters: {
        naukri_easy: async () => {
          throw new Error("page crashed");
        },
      },
    });
    await processApplication({
      application,
      user: { _id: "u1" },
      vault: {},
      log: { info: async () => {}, warn: async () => {}, job: async () => {} },
      ...deps,
    });
    assert.equal(application.status, "failed");
    assert.match(application.last_error, /page crashed/);
    assert.equal(application.attempt_counted, true);
    assert.ok(application.attempted_at instanceof Date);
    assert.equal(application.attempts, 1);
  });

  it("puts in-flight applications back to queued on cancel", async () => {
    const application = makeApp();
    const { deps } = baseDeps();
    await assert.rejects(
      () =>
        processApplication({
          application,
          user: { _id: "u1" },
          vault: {},
          checkCancel: async () => {
            const err = new Error("Run cancelled");
            err.name = "RunCancelled";
            throw err;
          },
          ...deps,
        }),
      (err) => err.name === "RunCancelled"
    );
    assert.equal(application.status, "queued");
  });
});

describe("processQueuedApplications", () => {
  it("stops at the daily cap and marks leftover queued jobs skipped_cap", async () => {
    const apps = [
      makeApp({ _id: "a1", job_id: "j1", createdAt: new Date(1) }),
      makeApp({ _id: "a2", job_id: "j2", createdAt: new Date(2) }),
    ];
    const jobs = {
      j1: makeJob({ _id: "j1" }),
      j2: makeJob({ _id: "j2", job_url: "https://www.naukri.com/job-listings-2" }),
    };
    let counted = 19;
    const { browser } = makeBrowser();
    await processQueuedApplications({
      user: { _id: "u1" },
      vault: { daily_attempt_cap: 20, auto_apply_enabled: true },
      browser,
      log: { info: async () => {}, warn: async () => {}, job: async () => {} },
      findJob: async (_userId, jobId) => jobs[String(jobId)],
      updateJob: async () => {},
      loadConnectedStates: async () => [{ portal: "naukri", storageState: {} }],
      refreshConnection: async () => {},
      markExpired: async () => {},
      writeResumeTemp: async () => ({ resumePath: "", cleanup: async () => {} }),
      saveScreenshot: async () => "",
      adapters: {
        naukri_easy: async () => {
          counted += 1;
          return { ok: true, attempted: true };
        },
      },
      countAttemptsToday: async () => counted,
      restoreSkippedCap: async () => {},
      recoverInFlight: async () => {},
      nextQueued: async () => apps.filter((a) => a.status === "queued").sort((a, b) => a.createdAt - b.createdAt)[0] || null,
      skipQueued: async () => {
        for (const app of apps) {
          if (app.status === "queued") app.status = "skipped_cap";
        }
        return { modifiedCount: 1 };
      },
    });
    assert.equal(apps[0].status, "applied");
    assert.equal(apps[1].status, "skipped_cap");
  });

  it("requeues in-flight applications left by a crashed run", async () => {
    const apps = [makeApp({ _id: "stuck", status: "executing", createdAt: new Date(1) })];
    const { browser } = makeBrowser();
    await processQueuedApplications({
      user: { _id: "u1" },
      vault: { daily_attempt_cap: 20, auto_apply_enabled: true },
      browser,
      log: { info: async () => {}, warn: async () => {}, job: async () => {} },
      findJob: async () => makeJob(),
      updateJob: async () => {},
      loadConnectedStates: async () => [{ portal: "naukri", storageState: {} }],
      refreshConnection: async () => {},
      markExpired: async () => {},
      writeResumeTemp: async () => ({ resumePath: "", cleanup: async () => {} }),
      saveScreenshot: async () => "",
      adapters: { naukri_easy: async () => ({ ok: true, attempted: true }) },
      countAttemptsToday: async () => 0,
      restoreSkippedCap: async () => {},
      recoverInFlight: async () => {
        for (const app of apps) {
          if (["classifying", "authenticating", "mapping_fields", "executing"].includes(app.status)) app.status = "queued";
        }
      },
      nextQueued: async () => apps.find((a) => a.status === "queued") || null,
      skipQueued: async () => ({ modifiedCount: 0 }),
    });
    assert.equal(apps[0].status, "applied");
  });

  it("requeues skipped_cap at start and leaves needs_help untouched", async () => {
    const apps = [
      makeApp({
        _id: "cap",
        status: "skipped_cap",
        last_error: "Daily apply cap reached",
        createdAt: new Date(1),
      }),
      makeApp({
        _id: "help",
        job_id: "j2",
        status: "needs_help",
        help_reason: "captcha",
        last_error: "captcha",
        createdAt: new Date(2),
      }),
    ];
    const { browser } = makeBrowser();
    await processQueuedApplications({
      user: { _id: "u1" },
      vault: { daily_attempt_cap: 20, auto_apply_enabled: true },
      browser,
      log: { info: async () => {}, warn: async () => {}, job: async () => {} },
      findJob: async () => makeJob(),
      updateJob: async () => {},
      loadConnectedStates: async () => [{ portal: "naukri", storageState: {} }],
      refreshConnection: async () => {},
      markExpired: async () => {},
      writeResumeTemp: async () => ({ resumePath: "", cleanup: async () => {} }),
      saveScreenshot: async () => "",
      adapters: { naukri_easy: async () => ({ ok: true, attempted: true }) },
      countAttemptsToday: async () => 0,
      restoreSkippedCap: async () => {
        for (const app of apps) {
          if (app.status === "skipped_cap") {
            app.status = "queued";
            app.last_error = "";
          }
        }
      },
      recoverInFlight: async () => {},
      nextQueued: async () => apps.find((a) => a.status === "queued") || null,
      skipQueued: async () => ({ modifiedCount: 0 }),
    });
    assert.equal(apps[0].status, "applied");
    assert.equal(apps[1].status, "needs_help");
    assert.equal(apps[1].help_reason, "captcha");
  });

  it("stops draining a disconnected portal and continues other portals", async () => {
    const apps = [
      makeApp({ _id: "n1", job_id: "jn1", portal_kind: "naukri_easy", createdAt: new Date(1) }),
      makeApp({ _id: "n2", job_id: "jn2", portal_kind: "naukri_easy", createdAt: new Date(2) }),
      makeApp({ _id: "l1", job_id: "jl1", portal_kind: "linkedin_easy", createdAt: new Date(3) }),
    ];
    const jobs = {
      jn1: makeJob({ _id: "jn1", source: "naukri", job_url: "https://www.naukri.com/job-listings-1" }),
      jn2: makeJob({ _id: "jn2", source: "naukri", job_url: "https://www.naukri.com/job-listings-2" }),
      jl1: makeJob({
        _id: "jl1",
        source: "linkedin",
        job_url: "https://www.linkedin.com/jobs/view/1",
        title: "PM",
        company: "Beta",
      }),
    };
    const { browser } = makeBrowser();
    await processQueuedApplications({
      user: { _id: "u1" },
      vault: { daily_attempt_cap: 20, auto_apply_enabled: true },
      browser,
      log: { info: async () => {}, warn: async () => {}, job: async () => {} },
      findJob: async (_userId, jobId) => jobs[String(jobId)],
      updateJob: async () => {},
      loadConnectedStates: async () => [{ portal: "linkedin", storageState: {} }],
      refreshConnection: async () => {},
      markExpired: async () => {},
      writeResumeTemp: async () => ({ resumePath: "", cleanup: async () => {} }),
      saveScreenshot: async () => "",
      adapters: {
        naukri_easy: async () => ({ ok: true, attempted: true }),
        linkedin_easy: async () => ({ ok: true, attempted: true }),
      },
      countAttemptsToday: async () => 0,
      restoreSkippedCap: async () => {},
      recoverInFlight: async () => {},
      nextQueued: async (_userId, exclude = []) => {
        const blocked = new Set(exclude);
        return (
          apps
            .filter((a) => a.status === "queued" && !blocked.has(a.portal_kind))
            .sort((a, b) => a.createdAt - b.createdAt)[0] || null
        );
      },
      skipQueued: async () => ({ modifiedCount: 0 }),
    });
    assert.equal(apps[0].status, "needs_help");
    assert.equal(apps[0].help_reason, "portal_disconnected");
    assert.equal(apps[1].status, "queued");
    assert.equal(apps[2].status, "applied");
    assert.equal(apps[2].portal_kind, "linkedin_easy");
  });
});

describe("attemptsTodayFilter", () => {
  it("counts attempt_counted docs by attempted_at, not updatedAt", () => {
    const q = attemptsTodayFilter("u1");
    assert.equal(q.user_id, "u1");
    assert.equal(q.attempt_counted, true);
    assert.ok(q.attempted_at.$gte instanceof Date);
    assert.equal("updatedAt" in q, false);
  });
});

describe("wiring", () => {
  it("registers auto_apply on the worker runner", () => {
    assert.equal(HANDLERS.auto_apply, autoApplyTask);
  });
});
