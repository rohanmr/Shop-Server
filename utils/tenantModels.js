const User = require("../models/User");

const getTenantUserModel = (tenantConnection) => {
  if (!tenantConnection) {
    throw new Error("Tenant database connection is required.");
  }

  return (
    tenantConnection.models.User ||
    tenantConnection.model("User", User.UserSchema)
  );
};

module.exports = {
  getTenantUserModel,
};
