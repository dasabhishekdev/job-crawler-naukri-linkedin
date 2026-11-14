const { parseArgs } = require("node:util");
const { connectDb, mongoose, User, Profile, JobPosting } = require("@jobportal/db");

const CITY_NAMES = { bangalore: "Bengaluru", bengaluru: "Bengaluru", kolkata: "Kolkata", hyderabad: "Hyderabad" };

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      slug: { type: "string", default: "anika" },
      exclude: { type: "string", multiple: true, default: [] },
    },
  });
  if (!values.email) throw new Error("Usage: migrate-legacy --email you@example.com [--slug anika] [--exclude Amazon]");

  await connectDb(process.env.MONGODB_URI || "mongodb://localhost:27017/jobportal");
  const user = await User.findOne({ email: values.email.toLowerCase() });
  if (!user) throw new Error(`No account for ${values.email}. Sign up in the app first.`);

  const db = mongoose.connection.db;
  const legacy = await db.collection("candidates").findOne({ slug: values.slug });
  if (!legacy) throw new Error(`No legacy candidate with slug "${values.slug}"`);

  const lp = legacy.profile || {};
  const cities = [...new Set((lp.locations || []).map((l) => CITY_NAMES[String(l).toLowerCase()]).filter(Boolean))];
  const profile = (await Profile.findOne({ user_id: user._id })) || new Profile({ user_id: user._id });
  profile.full_name = profile.full_name || legacy.name || "";
  profile.experience_years = profile.experience_years || lp.experience_years || 0;
  profile.target_roles = profile.target_roles.length ? profile.target_roles : lp.target_roles || [];
  profile.skills = profile.skills.length ? profile.skills : lp.skills || [];
  profile.target_locations = profile.target_locations.length ? profile.target_locations : cities;
  profile.exclude_companies = [...new Set([...profile.exclude_companies, ...values.exclude])];
  if (!profile.career_pages.length) {
    profile.career_pages = (legacy.career_pages || []).map(({ name, url, enabled }) => ({ name, url, enabled }));
  }
  await profile.save();

  const legacyJobs = await db
    .collection("jobs")
    .find({ candidate_id: legacy._id, source: { $in: ["web", "career_page"] } })
    .toArray();
  let copied = 0;
  for (const j of legacyJobs) {
    const res = await JobPosting.updateOne(
      { user_id: user._id, job_url: j.job_url },
      {
        $setOnInsert: {
          user_id: user._id,
          source: j.source,
          source_site: j.source_site,
          job_url: j.job_url,
          title: j.job_title,
          company: j.company,
          location: j.location,
          posted_text: j.posted_text,
          age_days: j.age_days,
          experience: j.experience_level,
          description: j.description,
          dedupe_key: j.dedupe_key,
          first_seen_at: j.first_seen_at || j.createdAt || new Date(),
          match: {},
          status: "new",
        },
      },
      { upsert: true }
    );
    copied += res.upsertedCount;
  }

  console.log(`Migrated profile (${profile.target_roles.length} roles, ${profile.career_pages.length} career pages) and ${copied} jobs into ${user.email}.`);
  console.log("Upload the resume in the app so it can be parsed and used for scoring and generation.");
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
