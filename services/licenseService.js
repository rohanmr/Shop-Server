const User = require("../models/User");
const License = require("../models/License");

const EXPIRED_LICENSE_MESSAGE =
  "License expired. Please contact administration to resolve this issue.";

const getLicenseAccessStatus = async (userId) => {
  const user = await User.findById(userId).populate({
    path: "licenseId",
    select: "code shopName status expiresAt",
  });

  if (!user) {
    return {
      allowed: false,
      statusCode: 401,
      message: "User not found. Please log in again.",
    };
  }

  // Super Admin accounts do not require a shop license.
  if (user.role === "super_admin") {
    return { allowed: true, user, license: null };
  }

  const license = user.licenseId;

  if (!license) {
    return {
      allowed: false,
      statusCode: 403,
      message:
        "No license is assigned to this account. Please contact administration.",
    };
  }

  if (!license.expiresAt || new Date(license.expiresAt) <= new Date()) {
    if (license.status !== "expired") {
      await License.updateOne(
        { _id: license._id },
        { $set: { status: "expired" } },
      );
    }

    return {
      allowed: false,
      statusCode: 403,
      message: EXPIRED_LICENSE_MESSAGE,
    };
  }

  // An expired license stays blocked until an authorized renewal
  // explicitly reactivates it.
  if (license.status === "expired") {
    return {
      allowed: false,
      statusCode: 403,
      message: EXPIRED_LICENSE_MESSAGE,
    };
  }

  if (license.status !== "active") {
    return {
      allowed: false,
      statusCode: 403,
      message:
        "Your license is suspended or inactive. Please contact administration.",
    };
  }

  return {
    allowed: true,
    user,
    license,
  };
};

const getDaysRemaining = (expiresAt) => {
  if (!expiresAt) return 0;

  const remainingMs = new Date(expiresAt).getTime() - Date.now();

  return Math.max(0, Math.ceil(remainingMs / (1000 * 60 * 60 * 24)));
};

module.exports = {
  EXPIRED_LICENSE_MESSAGE,
  getLicenseAccessStatus,
  getDaysRemaining,
};
