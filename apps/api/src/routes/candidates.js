const express = require("express");
const { Candidate, ResumeProfile } = require("@jobportal/db");
const {
  seedCandidates,
  getActiveCandidate,
  setActiveCandidate,
  resolveNaukriStoragePath,
} = require("@jobportal/agent");
const fs = require("fs");

const router = express.Router();

function serialize(candidate) {
  if (!candidate) return null;
  const storage = resolveNaukriStoragePath(candidate);
  return {
    ...candidate,
    naukri_logged_in: fs.existsSync(storage),
    naukri_session_updated_at: fs.existsSync(storage) ? fs.statSync(storage).mtime : null,
  };
}

router.get("/", async (_req, res) => {
  try {
    await seedCandidates();
    const candidates = await Candidate.find().sort("name").lean();
    const active = candidates.find((c) => c.is_active) || candidates[0] || null;
    res.json({
      candidates: candidates.map(serialize),
      active: serialize(active),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/activate", async (req, res) => {
  try {
    const candidate = await setActiveCandidate(req.params.id);
    const resume = candidate.resume_id
      ? await ResumeProfile.findById(candidate.resume_id).lean()
      : await ResumeProfile.findOne({ candidate_id: candidate._id }).sort("-uploaded_at").lean();
    if (resume) {
      await ResumeProfile.updateMany({}, { is_active: false });
      await ResumeProfile.findByIdAndUpdate(resume._id, { is_active: true, candidate_id: candidate._id });
    }
    res.json({
      message: `${candidate.name} is now active`,
      candidate: serialize(candidate.toObject()),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const allowed = ["apply_prefs", "max_apply_per_day", "ai_min_score", "profile"];
    const patch = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    const candidate = await Candidate.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });
    if (!candidate) return res.status(404).json({ error: "Candidate not found" });
    res.json({ candidate: serialize(candidate.toObject()) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/active", async (_req, res) => {
  try {
    const candidate = await getActiveCandidate();
    res.json({ candidate: serialize(candidate?.toObject ? candidate.toObject() : candidate) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
