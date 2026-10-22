const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const MasterUser = require("../models/User");
const License = require("../models/License");
const { getTenantConnection } = require("../config/tenantDb");

const authToken = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please log in.",
      });
    }

    const token = authorization.slice(7).trim();

    let decoded;

    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({
        success: false,
        message: "Your session is invalid or expired. Please log in again.",
      });
    }

    if (!decoded.id || !decoded.role) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token.",
      });
    }

    // Super Admin accounts are stored in the master database.
    if (decoded.role === "super_admin") {
      if (!mongoose.isValidObjectId(decoded.id)) {
        return res.status(401).json({
          success: false,
          message: "Invalid user identity.",
        });
      }

      const admin = await MasterUser.findOne({
        _id: decoded.id,
        role: "super_admin",
      }).select("_id name email role");

      if (!admin) {
        return res.status(401).json({
          success: false,
          message: "Super Admin account not found.",
        });
      }

      req.user = {
        id: String(admin._id),
        role: admin.role,
        email: admin.email,
      };

      return next();
    }

    // Shop Admin tokens must include verified tenant context.
    if (decoded.role !== "shop_admin") {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to access this resource.",
      });
    }

    if (
      !mongoose.isValidObjectId(decoded.id) ||
      !mongoose.isValidObjectId(decoded.tenantId) ||
      !mongoose.isValidObjectId(decoded.licenseId) ||
      !decoded.tenantDbName
    ) {
      return res.status(401).json({
        success: false,
        message: "Tenant authentication details are missing or invalid.",
      });
    }

    // Never trust tenant claims from the token alone.
    // Match them against the authoritative master license record.
    const license = await License.findOne({
      _id: decoded.licenseId,
      tenantId: decoded.tenantId,
      tenantDbName: decoded.tenantDbName,
    });

    if (!license) {
      return res.status(403).json({
        success: false,
        message: "License and tenant mapping could not be verified.",
      });
    }

    if (license.status !== "active") {
      return res.status(403).json({
        success: false,
        message: `This license is ${license.status}.`,
      });
    }

    if (
      !license.expiresAt ||
      new Date(license.expiresAt).getTime() <= Date.now()
    ) {
      return res.status(403).json({
        success: false,
        code: "LICENSE_EXPIRED",
        message: "License expired.",
      });
    }

    if (
      license.startDate &&
      new Date(license.startDate).getTime() > Date.now()
    ) {
      return res.status(403).json({
        success: false,
        message: "License is not active yet.",
      });
    }

    if (license.databaseProvisioningStatus !== "ready") {
      return res.status(409).json({
        success: false,
        message: "Tenant database is not ready.",
      });
    }

    // Resolve the tenant DB from the verified master license.
    const tenantContext = await getTenantConnection(license.tenantDbName);

    const tenantUser = await tenantContext.User.findOne({
      _id: decoded.id,
      email: decoded.email,
      role: "shop_admin",
      licenseId: license._id,
    }).select("_id name email role licenseId");

    if (!tenantUser) {
      return res.status(401).json({
        success: false,
        message: "Tenant user not found or no longer authorized.",
      });
    }

    req.user = {
      id: String(tenantUser._id),
      name: tenantUser.name,
      email: tenantUser.email,
      role: tenantUser.role,
      tenantId: String(license.tenantId),
      licenseId: String(license._id),
      tenantDbName: license.tenantDbName,
    };

    return next();
  } catch (error) {
    console.error("Authentication middleware error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Authentication could not be completed.",
    });
  }
};

const authRoles =
  (...allowedRoles) =>
  (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to access this resource.",
      });
    }

    return next();
  };

module.exports = { authToken, authRoles };
