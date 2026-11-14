const express = require("express");
const multer = require("multer");
const { Resume, enqueueRun } = require("@jobportal/db");
const { parseResume, resumeMimeType } = require("@jobportal/core");
const { aiReady } = require("@jobportal/ai");
const { uploadLimiter } = require("../middleware/security");
const { badRequest, notFound } = require("../lib/http-error");
const { publicResume } = require("../lib/serialize");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    cb(resumeMimeType(file.originalname) ? null : badRequest("Upload a PDF or DOCX resume."), true);
  },
});

const PDF_MAGIC = Buffer.from("%PDF");
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function contentMatchesExtension(buffer, mime) {
  if (mime === "application/pdf") return buffer.subarray(0, 4).equals(PDF_MAGIC);
  return buffer.subarray(0, 4).equals(ZIP_MAGIC);
}

async function queueParse(user) {
  if (!aiReady(user)) return null;
  const { run } = await enqueueRun({ userId: user._id, kind: "parse_resume", triggeredBy: "system" });
  return run._id;
}

function resumeRouter() {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const resume = await Resume.findOne({ user_id: req.user._id, is_current: true }).sort("-createdAt");
    res.json({ resume: publicResume(resume), text: resume?.text || "" });
  });

  router.post("/", uploadLimiter, upload.single("file"), async (req, res) => {
    if (!req.file) throw badRequest("Choose a resume file to upload.");
    const mime = resumeMimeType(req.file.originalname);
    if (!contentMatchesExtension(req.file.buffer, mime)) throw badRequest("This file is not a valid PDF or DOCX.");
    const text = await parseResume(req.file.buffer, req.file.originalname).catch((err) => {
      throw badRequest(err.message);
    });

    await Resume.updateMany({ user_id: req.user._id, is_current: true }, { $set: { is_current: false } });
    const resume = await Resume.create({
      user_id: req.user._id,
      filename: req.file.originalname.slice(0, 200),
      mime_type: mime,
      size: req.file.size,
      data: req.file.buffer,
      text,
      is_current: true,
      parse_status: "pending",
    });
    const runId = await queueParse(req.user);
    res.status(201).json({ resume: publicResume(resume), parse_run_id: runId, text });
  });

  router.post("/parse", async (req, res) => {
    const resume = await Resume.exists({ user_id: req.user._id, is_current: true });
    if (!resume) throw notFound("Upload a resume first.");
    if (!aiReady(req.user)) throw badRequest("Add an AI provider key in Settings first.");
    res.status(202).json({ run_id: await queueParse(req.user) });
  });

  router.get("/file", async (req, res) => {
    const resume = await Resume.findOne({ user_id: req.user._id, is_current: true }).select("+data").sort("-createdAt");
    if (!resume?.data) throw notFound("No resume uploaded.");
    res.set("Content-Type", resume.mime_type || "application/octet-stream");
    res.attachment(resume.filename);
    res.send(resume.data);
  });

  return router;
}

module.exports = { resumeRouter };
