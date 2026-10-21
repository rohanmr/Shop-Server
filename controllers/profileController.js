const User = require("../models/User");
const { getDaysRemaining } = require("../services/licenseService");
const fs = require("fs");
const path = require("path");

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

    const user = await User.findById(userId)
      .select("-password")
      .populate({
        path: "licenseId",
        select: "code shopName status expiresAt",
      })
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const license = user.licenseId
      ? {
          ...user.licenseId,
          daysRemaining: getDaysRemaining(user.licenseId.expiresAt),
        }
      : null;

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
      },
    });
  } catch (error) {
    console.error("Get profile error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch profile.",
    });
  }
};

// PATCH /api/users/profile
const updateMyProfile = async (req, res) => {
  let newImagePath = "";

  try {
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const updates = {};

    // Update name when supplied.
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

    // 2. Validate and update mobile number.
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

    // 3. Parse and update address.
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

      updates.address = cleanAddress;
    }

    // Update image when a new file is uploaded.
    if (req.file) {
      newImagePath = `/uploads/profiles/${req.file.filename}`;
      updates.profileImage = newImagePath;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide a name or profile image to update.",
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const oldImagePath = user.profileImage;

    Object.assign(user, updates);
    await user.save();

    // Best-effort cleanup after the database update succeeds.
    if (
      req.file &&
      oldImagePath &&
      oldImagePath.startsWith("/uploads/profiles/")
    ) {
      const oldFilePath = path.join(
        __dirname,
        "..",
        oldImagePath.replace(/^\/uploads\/profiles\//, "uploads/profiles/"),
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

    // Remove the newly uploaded file if the database update failed.
    if (req.file?.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error("New profile image cleanup failed:", cleanupError);
      }
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update profile.",
    });
  }
};

module.exports = {
  getMyProfile,
  updateMyProfile,
};
