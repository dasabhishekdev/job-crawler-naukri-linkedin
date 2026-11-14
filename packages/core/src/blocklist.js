const fs = require("fs");
const path = require("path");

function blocklistPath() {
  return process.env.BLOCKLIST_PATH || path.resolve(__dirname, "../../../config/blocklist.json");
}

function loadBlocklist() {
  try {
    const list = JSON.parse(fs.readFileSync(blocklistPath(), "utf8"));
    return Array.isArray(list) ? list.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

module.exports = { loadBlocklist };
