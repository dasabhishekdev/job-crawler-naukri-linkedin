const { JobPosting, GeneratedResume } = require("@jobportal/db");
const { syncUserSheet, uploadGeneratedResume } = require("@jobportal/google");
const { tailorResume } = require("../resume/tailor");
const { renderResumePdf } = require("../resume/pdf");
const { resumeFileName } = require("../resume/tailor-guard");
const { scoreJobs } = require("../crawl/score");
const { withAi, loadResumeAndProfile } = require("./shared");

async function generateResumeTask({ user, run, log, stage, checkCancel }) {
  const job = await JobPosting.findOne({ _id: run.payload?.job_id, user_id: user._id });
  if (!job) throw new Error("Job not found");
  const { resume, profile } = await loadResumeAndProfile(user);
  const doc = await GeneratedResume.findOneAndUpdate(
    { run_id: run._id },
    { $setOnInsert: { user_id: user._id, job_id: job._id, run_id: run._id, status: "queued" } },
    { upsert: true, new: true }
  );

  try {
    const result = await withAi(user, async (ai) => {
      if (!job.match?.keywords?.length) {
        await stage("score", "Reading the job description");
        await scoreJobs({ ai, jobs: [job], resumeText: resume.text, profile: profile || {}, log, checkCancel });
      }
      await stage("write", `Writing a resume for ${job.title} at ${job.company}`);
      return tailorResume({ ai, resumeText: resume.text, structured: profile?.structured_resume, job });
    });
    await checkCancel();

    await stage("pdf", "Creating the PDF");
    const pdf = await renderResumePdf(result.resume);
    const filename = resumeFileName(profile?.full_name || user.name || "Resume", job.company, job.title);
    Object.assign(doc, {
      status: "done",
      resume_json: result.resume,
      ats_before: result.ats_before,
      ats_after: result.ats_after,
      filename,
      pdf,
      error: "",
    });
    await doc.save();
    job.latest_resume_id = doc._id;
    await job.save();
    await log.info(`Resume ready: ATS ${result.ats_before ?? "?"}% → ${result.ats_after ?? "?"}%`);

    if (user.google?.refresh_token) {
      await stage("upload", "Uploading to Google Drive");
      try {
        doc.drive_url = await uploadGeneratedResume(user, { company: job.company, title: job.title, fileName: filename, buffer: pdf });
        await doc.save();
        await syncUserSheet(user);
        await log.info("Uploaded to Google Drive");
      } catch (err) {
        await log.warn(`Drive upload failed: ${err.message}`);
      }
    }
    return { generated_resume_id: doc._id, ats_before: result.ats_before, ats_after: result.ats_after };
  } catch (err) {
    await GeneratedResume.updateOne({ _id: doc._id }, { $set: { status: "failed", error: err.message.slice(0, 500) } });
    throw err;
  }
}

module.exports = { generateResumeTask };
