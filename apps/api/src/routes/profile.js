const express = require("express");
const { z } = require("zod");
const { Profile } = require("@jobportal/db");

const text = (max) => z.string().trim().max(max);
const list = (maxItems, maxLen) =>
  z
    .array(z.string().trim().min(1).max(maxLen))
    .max(maxItems)
    .transform((items) => [...new Map(items.map((i) => [i.toLowerCase(), i])).values()]);

const profileSchema = z
  .object({
    full_name: text(120),
    headline: text(200),
    phone: text(40),
    current_location: text(120),
    summary: text(1500),
    experience_years: z.coerce.number().min(0).max(60),
    target_roles: list(15, 80),
    skills: list(40, 60),
    target_locations: list(8, 60),
    remote_ok: z.boolean(),
    exclude_companies: list(50, 80),
  })
  .partial();

const careerPagesSchema = z.object({
  pages: z
    .array(
      z.object({
        name: text(80).default(""),
        url: z.string().trim().url("Enter a full URL starting with https://").max(500).refine((u) => /^https?:\/\//i.test(u), "Use an http(s) URL"),
        enabled: z.boolean().default(true),
      })
    )
    .max(40),
});

function profileRouter() {
  const router = express.Router();

  async function getProfile(userId) {
    return (await Profile.findOne({ user_id: userId })) || Profile.create({ user_id: userId });
  }

  router.get("/", async (req, res) => {
    res.json({ profile: await getProfile(req.user._id) });
  });

  router.put("/", async (req, res) => {
    const patch = profileSchema.parse(req.body);
    const profile = await getProfile(req.user._id);
    Object.assign(profile, patch, { edited_by_user: true });
    await profile.save();
    res.json({ profile });
  });

  router.put("/career-pages", async (req, res) => {
    const { pages } = careerPagesSchema.parse(req.body);
    const profile = await getProfile(req.user._id);
    const previous = new Map(profile.career_pages.map((p) => [p.url, p]));
    profile.career_pages = pages.map((p) => {
      const old = previous.get(p.url);
      return old ? { ...old.toObject(), ...p } : p;
    });
    await profile.save();
    res.json({ career_pages: profile.career_pages });
  });

  return router;
}

module.exports = { profileRouter };
