const { getLeadsWithEmails, closeDb } = require("./storage/sqlite");
const fs = require("fs");
const path = require("path");

const outPath = path.resolve(__dirname, "..", "leads-export.json");

const leads = getLeadsWithEmails().map((row) => ({
  ...row,
  emails: JSON.parse(row.emails || "[]"),
  match_reasons: JSON.parse(row.match_reasons || "[]"),
}));

fs.writeFileSync(outPath, JSON.stringify(leads, null, 2));
console.log(`Exported ${leads.length} leads with emails to ${outPath}`);
closeDb();
