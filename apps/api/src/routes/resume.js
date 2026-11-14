const express = require("express");
const multer = require("multer");
const { ResumeProfile } = require("@jobportal/db");
const { parseResume } = require("@jobportal/core");
const { getActiveCandidate } = require("@jobportal/agent");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = express.Router();

router.post("/upload", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const text = await parseResume(req.file.buffer, req.file.originalname);
    const candidate = await getActiveCandidate();
    await ResumeProfile.updateMany({}, { is_active: false });
    const doc = await ResumeProfile.create({
      filename: req.file.originalname,
      mime_type: req.file.mimetype,
      text,
      is_active: true,
      candidate_id: candidate?._id,
    });
    if (candidate) {
      candidate.resume_id = doc._id;
      await candidate.save();
    }
    res.json({
      message: "Resume uploaded",
      resume_id: doc._id,
      filename: doc.filename,
      text_length: text.length,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/active", async (_req, res) => {
  try {
    const candidate = await getActiveCandidate();
    let doc = null;
    if (candidate?.resume_id) {
      doc = await ResumeProfile.findById(candidate.resume_id).lean();
    }
    if (!doc && candidate?._id) {
      doc = await ResumeProfile.findOne({ candidate_id: candidate._id }).sort("-uploaded_at").lean();
    }
    if (!doc) {
      doc = await ResumeProfile.findOne({ is_active: true }).sort("-uploaded_at").lean();
    }
    if (!doc) return res.json({ active: false });
    res.json({
      active: true,
      resume_id: doc._id,
      filename: doc.filename,
      uploaded_at: doc.uploaded_at,
      text_length: doc.text?.length || 0,
      candidate_id: doc.candidate_id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
