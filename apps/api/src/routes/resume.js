const express = require("express");
const multer = require("multer");
const { ResumeProfile } = require("@jobportal/db");
const { parseResume } = require("@jobportal/core");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = express.Router();

router.post("/upload", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const text = await parseResume(req.file.buffer, req.file.originalname);
    await ResumeProfile.updateMany({}, { is_active: false });
    const doc = await ResumeProfile.create({
      filename: req.file.originalname,
      mime_type: req.file.mimetype,
      text,
      is_active: true,
    });
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
    const doc = await ResumeProfile.findOne({ is_active: true }).sort("-uploaded_at").lean();
    if (!doc) return res.json({ active: false });
    res.json({
      active: true,
      resume_id: doc._id,
      filename: doc.filename,
      uploaded_at: doc.uploaded_at,
      text_length: doc.text?.length || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
