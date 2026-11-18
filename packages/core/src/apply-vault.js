const REQUIRED = ["full_name", "email", "phone"];

function vaultMissingFields(vault = {}) {
  return REQUIRED.filter((k) => !String(vault[k] || "").trim());
}

function isVaultReady(vault) {
  return vaultMissingFields(vault).length === 0;
}

module.exports = { vaultMissingFields, isVaultReady, REQUIRED_VAULT_FIELDS: REQUIRED };