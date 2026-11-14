const { PortalConnection } = require("@jobportal/db");
const { encryptSecret, decryptSecret } = require("@jobportal/ai");

async function saveConnection(userId, portal, storageState) {
  await PortalConnection.findOneAndUpdate(
    { user_id: userId, portal },
    {
      $set: {
        status: "connected",
        storage_state: encryptSecret(JSON.stringify(storageState)),
        connected_at: new Date(),
        last_checked_at: new Date(),
        last_error: "",
      },
    },
    { upsert: true }
  );
}

async function refreshConnection(userId, portal, storageState) {
  await PortalConnection.updateOne(
    { user_id: userId, portal },
    { $set: { storage_state: encryptSecret(JSON.stringify(storageState)), last_checked_at: new Date(), last_crawl_at: new Date(), last_error: "" } }
  );
}

async function markExpired(userId, portal, message) {
  await PortalConnection.updateOne(
    { user_id: userId, portal },
    { $set: { status: "expired", last_checked_at: new Date(), last_error: String(message || "").slice(0, 300) } }
  );
}

async function loadConnectedStates(userId) {
  const rows = await PortalConnection.find({ user_id: userId, status: "connected" }).select("+storage_state").lean();
  return rows.map((row) => ({ portal: row.portal, storageState: JSON.parse(decryptSecret(row.storage_state)) }));
}

module.exports = { saveConnection, refreshConnection, markExpired, loadConnectedStates };
