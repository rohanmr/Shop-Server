const User = require("../models/User");
const License = require("../models/License");

const bcrypt = require("bcrypt");

const createShopAdmin = async (req, res) => {
  const { name, email, password, role, mobile, licenseCode, address } =
    req.body;

  if (!name || !email || !password || !role || !mobile) {
    return res
      .status(400)
      .json({ message: "All registration parameters are required." });
  }

  try {
    // Prevent duplicate account registrations
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedMobile =
      typeof mobile === "string" ? mobile.trim().replace(/[\s()-]/g, "") : "";

    if (!/^\+?[0-9]{7,15}$/.test(normalizedMobile)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid mobile number.",
      });
    }

    const userExists = await User.findOne({
      email: normalizedEmail,
    });

    if (userExists) {
      return res.status(400).json({
        message: "A user with this email already exists.",
      });
    }

    let assignedLicenseId = null;

    // Validation rule enforcement for Shop Admins
    if (role === "shop_admin") {
      if (!licenseCode || !licenseCode.trim()) {
        return res.status(400).json({
          success: false,
          message: "A valid license key is required to create a Shop Admin.",
        });
      }

      const normalizedLicenseCode = licenseCode.trim();

      // Check if license is active and valid
      const targetLicense = await License.findOne({
        code: normalizedLicenseCode,
      });

      if (!targetLicense) {
        return res.status(404).json({
          message: "The provided license code was not found pls create.",
        });
      }
      if (targetLicense.status !== "active") {
        return res.status(403).json({
          success: false,
          message: `This license is ${targetLicense.status} and cannot be assigned.`,
        });
      }

      //Check whether license is already assigned
      const existingLicenseUser = await User.findOne({
        licenseId: targetLicense._id,
        role: "shop_admin",
      });

      if (existingLicenseUser) {
        return res.status(409).json({
          success: false,
          message:
            "This license code is already assigned to another Shop Admin.",
        });
      }

      assignedLicenseId = targetLicense._id;
    }

    // Securely hash the plain-text password using strong salting guidelines
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Commit record to MongoDB
    const newUser = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      mobile: normalizedMobile,
      password: hashedPassword,
      role,
      licenseId: assignedLicenseId,
      address: {
        street: address?.street?.trim() || "",
        city: address?.city?.trim() || "",
        state: address?.state?.trim() || "",
        pincode: address?.pincode?.trim() || "",
        country: address?.country?.trim() || "India",
      },
    });

    return res.status(201).json({
      message: "Shop Admin created successfully.",
      success: true,
    });
  } catch (error) {
    return res.status(500).json({
      message: "An error occurred while creating the user.",
      error: error.message,
    });
  }
};

const createSuperAdmin = async (req, res) => {
  const { name, email, password } = req.body;

  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({
      success: false,
      message: "Name, email, and password are required.",
    });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();

    // Check if email already exists
    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "A user with this email already exists.",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create another Super Admin
    const newSuperAdmin = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: "super_admin",
      licenseId: null,
    });

    return res.status(201).json({
      success: true,
      message: "Super Admin created successfully.",
    });
  } catch (error) {
    console.error("Create Super Admin error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create Super Admin.",
    });
  }
};

const getAllShopAdmins = async (req, res) => {
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

    // Filter shop admins
    const filter = { role: "shop_admin" };

    // Search by name or email
    if (search && search.trim()) {
      filter.$or = [
        { name: { $regex: search.trim(), $options: "i" } },
        { email: { $regex: search.trim(), $options: "i" } },
      ];
    }

    // Filter by license status
    if (status) {
      if (!["active", "suspended", "expired"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid license status.",
        });
      }

      const licenses = await License.find({ status }).select("_id");
      filter.licenseId = { $in: licenses.map((license) => license._id) };
    }

    const skip = (currentPage - 1) * perPage;

    const [shopAdmins, total] = await Promise.all([
      User.find(filter)
        .select("-password")
        .populate("licenseId", "code shopName status expiresAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(perPage),

      User.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      count: shopAdmins.length,
      total,
      currentPage,
      totalPages: Math.ceil(total / perPage),
      shopAdmins,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch shop admins.",
      error: error.message,
    });
  }
};

const getShopAdminById = async (req, res) => {
  try {
    const { id } = req.params;

    const shopAdmin = await User.findOne({
      _id: id,
      role: "shop_admin",
    })
      .select("-password")
      .populate("licenseId", "code shopName status expiresAt")
      .lean();

    if (!shopAdmin) {
      return res.status(404).json({
        success: false,
        message: "Shop Admin not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Shop Admin fetched successfully.",
      shopAdmin,
    });
  } catch (error) {
    console.error("Get Shop Admin error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch Shop Admin.",
    });
  }
};

const updateShopAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, mobile, address } = req.body;

    const shopAdmin = await User.findOne({
      _id: id,
      role: "shop_admin",
    }).select("_id");

    if (!shopAdmin) {
      return res.status(404).json({
        success: false,
        message: "Shop Admin not found.",
      });
    }

    const updates = {};

    // Update name
    if (name !== undefined) {
      if (typeof name !== "string") {
        return res.status(400).json({
          success: false,
          message: "Name must be a string.",
        });
      }

      const cleanName = name.trim();

      if (cleanName.length < 2 || cleanName.length > 100) {
        return res.status(400).json({
          success: false,
          message: "Name must be between 2 and 100 characters.",
        });
      }

      updates.name = cleanName;
    }

    // Update email
    if (email !== undefined) {
      if (typeof email !== "string") {
        return res.status(400).json({
          success: false,
          message: "Email must be a string.",
        });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (normalizedEmail.length > 254 || !emailPattern.test(normalizedEmail)) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid email address.",
        });
      }

      const existingUser = await User.findOne({
        email: normalizedEmail,
        _id: { $ne: id },
      }).select("_id");

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: "This email is already registered.",
        });
      }

      updates.email = normalizedEmail;
    }

    // Update mobile number
    if (mobile !== undefined) {
      if (typeof mobile !== "string") {
        return res.status(400).json({
          success: false,
          message: "Mobile number must be a string.",
        });
      }

      const cleanMobile = mobile.trim().replace(/[\s()-]/g, "");

      if (!/^\+?[0-9]{7,15}$/.test(cleanMobile)) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid mobile number.",
        });
      }

      updates.mobile = cleanMobile;
    }

    // Update address fields
    if (address !== undefined) {
      if (!address || typeof address !== "object" || Array.isArray(address)) {
        return res.status(400).json({
          success: false,
          message: "Address must be an object.",
        });
      }

      const allowedFields = ["street", "city", "state", "pincode", "country"];

      const currentAddress = await User.findById(id).select("address");
      const updatedAddress = {
        street: currentAddress?.address?.street || "",
        city: currentAddress?.address?.city || "",
        state: currentAddress?.address?.state || "",
        pincode: currentAddress?.address?.pincode || "",
        country: currentAddress?.address?.country || "India",
      };

      for (const field of allowedFields) {
        if (address[field] !== undefined) {
          if (typeof address[field] !== "string") {
            return res.status(400).json({
              success: false,
              message: `${field} must be a string.`,
            });
          }

          updatedAddress[field] = address[field].trim();
        }
      }

      updates.address = updatedAddress;
    }

    const updatedShopAdmin = await User.findOneAndUpdate(
      {
        _id: id,
        role: "shop_admin",
      },
      {
        $set: updates,
      },
      {
        new: true,
        runValidators: true,
      },
    ).select("_id name email mobile address role licenseId createdAt");

    if (!updatedShopAdmin) {
      return res.status(404).json({
        success: false,
        message: "Shop Admin not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Shop Admin updated successfully.",
      shopAdmin: updatedShopAdmin,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This email is already registered.",
      });
    }

    console.error("Update Shop Admin error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update Shop Admin.",
    });
  }
};

const deleteShopAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    // Delete only the user whose role is shop_admin.
    const deletedAdmin = await User.findOneAndDelete({
      _id: id,
      role: "shop_admin",
    }).select("_id name email role licenseId");

    if (!deletedAdmin) {
      return res.status(404).json({
        success: false,
        message: "Shop Admin not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Shop Admin deleted successfully.",
    });
  } catch (error) {
    console.error("Delete Shop Admin error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete Shop Admin.",
    });
  }
};

module.exports = {
  createShopAdmin,
  createSuperAdmin,
  getAllShopAdmins,
  getShopAdminById,
  updateShopAdmin,
  deleteShopAdmin,
};
