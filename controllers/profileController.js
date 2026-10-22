const User = require("../models/User");
const { getTenantConnection } = require("../config/tenantDb");
const { getDaysRemaining } = require("../services/licenseService");
const fs = require("fs");
const path = require("path");

// Resolve the correct User model for the authenticated user.
const getCurrentUserModel = async (req) => {
  const { role, tenantId, licenseId, tenantDbName } = req.user || {};

  if (role === "shop_admin") {
    if (!tenantId || !licenseId || !tenantDbName) {
      const error = new Error(
        "Tenant information is missing from the session.",
      );
      error.statusCode = 401;
      throw error;
    }

    // Never accept a tenant database name from request body or query.
    // Use the tenant context issued in the authenticated JWT.
    const tenantContext = await getTenantConnection(tenantDbName);
    const TenantUser = tenantContext.User;

    // Verify that this user belongs to the tenant and license in the JWT.
    const tenantUser = await TenantUser.findOne({
      _id: req.user.id || req.user._id,
      role: "shop_admin",
      licenseId,
    }).select("_id");

    if (!tenantUser) {
      const error = new Error("User not found in this tenant.");
      error.statusCode = 404;
      throw error;
    }

    return TenantUser;
  }

  // Super Admin and other master-database users.
  return User;
};

// GET /api/users/profile
const getMyProfile = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const UserModel = await getCurrentUserModel(req);

    const user = await UserModel.findById(userId).select("-password").lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    let license = null;

    if (user.licenseId) {
      // The license details live in the master database.
      const masterLicense = await require("../models/License")
        .findById(user.licenseId)
        .select("code shopName status expiresAt")
        .lean();

      if (masterLicense) {
        license = {
          ...masterLicense,
          daysRemaining: getDaysRemaining(masterLicense.expiresAt),
        };
      }
    }

    return res.status(200).json({
      success: true,
      message: "Profile fetched successfully.",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
        address: {
          street: user.address?.street || "",
          city: user.address?.city || "",
          state: user.address?.state || "",
          pincode: user.address?.pincode || "",
          country: user.address?.country || "India",
        },
        profileImage: user.profileImage || "",
        license,
        createdAt: user.createdAt,
        tenantId: req.user.tenantId || null,
      },
    });
  } catch (error) {
    console.error("Get profile error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Failed to fetch profile.",
    });
  }
};

// PATCH /api/users/profile
const updateMyProfile = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const UserModel = await getCurrentUserModel(req);
    const user = await UserModel.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const updates = {};

    if (req.body.name !== undefined) {
      const name =
        typeof req.body.name === "string" ? req.body.name.trim() : "";

      if (name.length < 2 || name.length > 100) {
        return res.status(400).json({
          success: false,
          message: "Name must be between 2 and 100 characters.",
        });
      }

      updates.name = name;
    }

    if (req.body.mobile !== undefined) {
      const mobile =
        typeof req.body.mobile === "string"
          ? req.body.mobile.trim().replace(/[\s()-]/g, "")
          : "";

      if (!/^\+?[0-9]{7,15}$/.test(mobile)) {
        return res.status(400).json({
          success: false,
          message: "Please enter a valid mobile number.",
        });
      }

      updates.mobile = mobile;
    }

    if (req.body.address !== undefined) {
      let address;

      try {
        address =
          typeof req.body.address === "string"
            ? JSON.parse(req.body.address)
            : req.body.address;
      } catch {
        return res.status(400).json({
          success: false,
          message: "Invalid address format.",
        });
      }

      if (!address || typeof address !== "object" || Array.isArray(address)) {
        return res.status(400).json({
          success: false,
          message: "Invalid address format.",
        });
      }

      const fields = ["street", "city", "state", "pincode", "country"];
      const cleanAddress = {};

      for (const field of fields) {
        if (
          address[field] !== undefined &&
          typeof address[field] !== "string"
        ) {
          return res.status(400).json({
            success: false,
            message: `Invalid address field: ${field}.`,
          });
        }

        cleanAddress[field] =
          typeof address[field] === "string"
            ? address[field].trim()
            : user.address?.[field] || (field === "country" ? "India" : "");
      }

      updates.address = {
        ...(user.address?.toObject?.() || user.address || {}),
        ...cleanAddress,
      };
    }

    if (req.file) {
      updates.profileImage = `/uploads/profiles/${req.file.filename}`;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide a name, mobile, address, or profile image to update.",
      });
    }

    const oldImagePath = user.profileImage;

    Object.assign(user, updates);
    await user.save();

    // Delete the previous image only after the database update succeeds.
    if (
      req.file &&
      oldImagePath &&
      oldImagePath.startsWith("/uploads/profiles/")
    ) {
      const oldFilePath = path.resolve(
        __dirname,
        "..",
        oldImagePath.replace(/^\/+/, ""),
      );

      try {
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      } catch (cleanupError) {
        console.error("Old profile image cleanup failed:", cleanupError);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
    });
  } catch (error) {
    console.error("Update profile error:", error);

    // Remove a newly uploaded file if updating the profile failed.
    if (req.file?.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error("New profile image cleanup failed:", cleanupError);
      }
    }

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Failed to update profile.",
    });
  }
};

module.exports = {
  getMyProfile,
  updateMyProfile,
};
