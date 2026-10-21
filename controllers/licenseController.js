// controllers/licenseController.js
const License = require("../models/License");
const User = require("../models/User");
const { getDaysRemaining } = require("../services/licenseService");

const createLicense = async (req, res) => {
  const { licenseCode, shopName, durationMonths } = req.body;

  if (!licenseCode || !shopName || !durationMonths) {
    return res
      .status(400)
      .json({ message: "License Code, Shop Name, and Duration are required." });
  }

  try {
    const cleanCode = licenseCode.trim().toUpperCase();

    const existingLicense = await License.findOne({ code: cleanCode });
    if (existingLicense) {
      return res.status(400).json({
        message:
          "This specific license key is already registered in the system.",
      });
    }

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + parseInt(durationMonths));

    const newLicense = await License.create({
      code: cleanCode,
      shopName,
      status: "active",
      expiresAt,
    });

    return res.status(201).json({
      message: "Shop License Created Successfully",
      license: newLicense,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Subsystem execution error.", error: error.message });
  }
};

const getAllLicenses = async (req, res) => {
  try {
    const { search, status, page = 1, limit = 10 } = req.query;

    // Pagination validation
    const currentPage = Number(page);
    const perPage = Number(limit);

    if (
      !Number.isInteger(currentPage) ||
      currentPage < 1 ||
      !Number.isInteger(perPage) ||
      perPage < 1 ||
      perPage > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid page or limit.",
      });
    }

    // Base filter
    const filter = {};

    // Search by shop name or license code
    if (search && search.trim()) {
      const escapedSearch = search
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      filter.$or = [
        {
          shopName: {
            $regex: escapedSearch,
            $options: "i",
          },
        },
        {
          code: {
            $regex: escapedSearch,
            $options: "i",
          },
        },
      ];
    }

    // Filter by license status
    if (status && status !== "all") {
      if (!["active", "suspended", "expired"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid license status.",
        });
      }

      filter.status = status;
    }

    // Pagination
    const skip = (currentPage - 1) * perPage;

    // Fetch licenses and total matching count
    const [licenses, total] = await Promise.all([
      License.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(perPage)
        .lean(),

      License.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      message: "Licenses fetched successfully.",
      count: licenses.length,
      total,
      currentPage,
      totalPages: Math.ceil(total / perPage),
      licenses,
    });
  } catch (error) {
    console.error("Get all licenses error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch licenses.",
    });
  }
};

const getAvailableLicenses = async (req, res) => {
  try {
    // Find licenses that are active
    const licenses = await License.find({
      status: "active",
    })
      .select("_id code shopName expiresAt")
      .sort({ createdAt: -1 })
      .lean();

    // Find Shop Admins who already have a license
    const assignedUsers = await User.find({
      role: "shop_admin",
      licenseId: { $in: licenses.map((license) => license._id) },
    })
      .select("licenseId")
      .lean();

    const assignedLicenseIds = new Set(
      assignedUsers.map((user) => String(user.licenseId)),
    );

    // Return only licenses that are not assigned
    const availableLicenses = licenses.filter(
      (license) => !assignedLicenseIds.has(String(license._id)),
    );

    return res.status(200).json({
      success: true,
      message: "Available licenses fetched successfully.",
      licenses: availableLicenses,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch available licenses.",
      error: error.message,
    });
  }
};

const renewLicense = async (req, res) => {
  try {
    const { id } = req.params;
    const { durationMonths } = req.body;

    const months = Number(durationMonths);

    if (!Number.isInteger(months) || months <= 0) {
      return res.status(400).json({
        success: false,
        message: "Provide a valid renewal duration in months.",
      });
    }

    const license = await License.findById(id);

    if (!license) {
      return res.status(404).json({
        success: false,
        message: "License not found.",
      });
    }

    const now = new Date();

    // Preserve remaining validity when renewing early.
    // For an already-expired license, extend from today.
    const renewalStart =
      license.expiresAt && new Date(license.expiresAt) > now
        ? new Date(license.expiresAt)
        : now;

    renewalStart.setMonth(renewalStart.getMonth() + months);

    license.expiresAt = renewalStart;
    license.status = "active";

    await license.save();

    return res.status(200).json({
      success: true,
      message: "License renewed successfully.",
      license: {
        ...license.toObject(),
        daysRemaining: getDaysRemaining(license.expiresAt),
      },
    });
  } catch (error) {
    console.error("Renew license error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to renew license.",
    });
  }
};

const updateLicense = async (req, res) => {
  try {
    const { id } = req.params;
    const { licenseCode, shopName } = req.body;

    const license = await License.findById(id);

    if (!license) {
      return res.status(404).json({
        success: false,
        message: "License not found.",
      });
    }

    const updates = {};

    if (licenseCode !== undefined) {
      const cleanCode = licenseCode.trim().toUpperCase();

      if (!/^[A-Z0-9-]{3,100}$/.test(cleanCode)) {
        return res.status(400).json({
          success: false,
          message:
            "License code must contain 3–100 letters, numbers, or hyphens.",
        });
      }

      const duplicate = await License.findOne({
        code: cleanCode,
        _id: { $ne: license._id },
      });

      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: "This license code already exists.",
        });
      }

      updates.code = cleanCode;
    }

    if (shopName !== undefined) {
      const cleanShopName = shopName.trim();

      if (
        cleanShopName.length < 2 ||
        cleanShopName.length > 150 ||
        !/^[a-zA-Z0-9\s&'().-]+$/.test(cleanShopName)
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid shop name.",
        });
      }

      updates.shopName = cleanShopName;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one field to update.",
      });
    }

    Object.assign(license, updates);
    await license.save();

    return res.status(200).json({
      success: true,
      message: "License updated successfully.",
      license: license.toObject(),
    });
  } catch (error) {
    console.error("Update license error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update license.",
    });
  }
};

const deleteLicense = async (req, res) => {
  try {
    const { id } = req.params;

    const license = await License.findById(id);

    if (!license) {
      return res.status(404).json({
        success: false,
        message: "License not found.",
      });
    }

    // Check whether any Shop Admin is assigned to this license.
    const assignedUser = await User.findOne({
      licenseId: license._id,
    }).select("_id name email");

    if (assignedUser) {
      return res.status(409).json({
        success: false,
        assigned: true,
        message:
          "This license is assigned to a Shop Admin and can not be deleted.",
      });
    }

    await License.deleteOne({ _id: license._id });

    return res.status(200).json({
      success: true,
      message: "License deleted successfully.",
    });
  } catch (error) {
    console.error("Delete license error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete license.",
    });
  }
};

module.exports = {
  createLicense,
  getAllLicenses,
  getAvailableLicenses,
  renewLicense,
  updateLicense,
  deleteLicense,
};
