const getTenantConnection = require("../config/tenantDb").getTenantConnection;
const bcrypt = require("bcrypt");
const License = require("../models/License");
const User = require("../models/User");

const createShopAdmin = async (req, res) => {
  const { name, email, password, mobile, licenseCode, address } = req.body;

  // 1. Validate required fields
  if (!name || !email || !password || !mobile || !licenseCode) {
    return res.status(400).json({
      success: false,
      message: "Name, email, password, mobile, and license code are required.",
    });
  }

  try {
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedLicenseCode = licenseCode.trim().toUpperCase();

    const normalizedMobile =
      typeof mobile === "string"
        ? mobile.trim().replace(/[\s()-]/g, "")
        : String(mobile).trim();

    if (!normalizedName) {
      return res.status(400).json({
        success: false,
        message: "Name is required.",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    if (!/^\+?[0-9]{7,15}$/.test(normalizedMobile)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid mobile number.",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must contain at least 8 characters.",
      });
    }

    // 2. Find the license in the master database
    const license = await License.findOne({
      code: normalizedLicenseCode,
    });

    if (!license) {
      return res.status(404).json({
        success: false,
        message: "License not found. Please check the license code.",
      });
    }

    // 3. Validate license status
    if (license.status !== "active") {
      return res.status(403).json({
        success: false,
        message: `This license is ${license.status} and cannot be assigned.`,
      });
    }

    if (
      !license.expiresAt ||
      new Date(license.expiresAt).getTime() <= Date.now()
    ) {
      return res.status(403).json({
        success: false,
        message: "This license has expired.",
      });
    }

    if (
      license.startDate &&
      new Date(license.startDate).getTime() > Date.now()
    ) {
      return res.status(403).json({
        success: false,
        message: "This license is not active yet.",
      });
    }

    // 4. Ensure tenant provisioning has completed
    if (
      license.databaseProvisioningStatus !== "ready" ||
      !license.tenantDbName ||
      !license.tenantId
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Tenant database is not ready. Please retry provisioning first.",
        databaseProvisioningStatus: license.databaseProvisioningStatus,
      });
    }

    // 5. Connect to this license's tenant database
    const tenantContext = await getTenantConnection(license.tenantDbName);
    const TenantUser = tenantContext.User;

    // 6. Check whether this email already exists in this tenant
    const existingUser = await TenantUser.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "A user with this email already exists in this tenant.",
      });
    }

    // 7. Only one Shop Admin per license for this implementation
    const existingShopAdmin = await TenantUser.findOne({
      licenseId: license._id,
      role: "shop_admin",
    });

    if (existingShopAdmin) {
      return res.status(409).json({
        success: false,
        message: "This license is already assigned to a Shop Admin.",
      });
    }

    // 8. Check the license's user limit, if configured
    if (Number.isFinite(license.maxUsers) && license.maxUsers > 0) {
      const currentUserCount = await TenantUser.countDocuments();

      if (currentUserCount >= license.maxUsers) {
        return res.status(403).json({
          success: false,
          message: "This license has reached its maximum user limit.",
        });
      }
    }

    // 9. Hash the password
    const hashedPassword = await bcrypt.hash(password, 12);

    // 10. Create the Shop Admin in the tenant database
    const shopAdmin = await TenantUser.create({
      name: normalizedName,
      email: normalizedEmail,
      password: hashedPassword,
      mobile: normalizedMobile,
      role: "shop_admin",
      licenseId: license._id,
      address: {
        street:
          typeof address?.street === "string" ? address.street.trim() : "",
        city: typeof address?.city === "string" ? address.city.trim() : "",
        state: typeof address?.state === "string" ? address.state.trim() : "",
        pincode:
          typeof address?.pincode === "string" ? address.pincode.trim() : "",
        country:
          typeof address?.country === "string" && address.country.trim()
            ? address.country.trim()
            : "India",
      },
    });

    // 11. Return safe response fields only
    return res.status(201).json({
      success: true,
      message: "Shop Admin created successfully in the tenant database.",
      user: {
        id: shopAdmin._id,
        name: shopAdmin.name,
        email: shopAdmin.email,
        mobile: shopAdmin.mobile,
        role: shopAdmin.role,
        tenantId: license.tenantId,
        licenseId: license._id,
        licenseCode: license.code,
      },
    });
  } catch (error) {
    console.error("Create Shop Admin error:", error);

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A user with the same unique value already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Unable to create Shop Admin.",
    });
  }
};

const createSuperAdmin = async (req, res) => {
  const { name, email, password, mobile } = req.body;

  if (!name?.trim() || !email?.trim() || !password || !mobile?.trim()) {
    return res.status(400).json({
      success: false,
      message: "Name, email, password, and mobile are required.",
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

    const systemLicenseCode =
      process.env.SUPER_ADMIN_LICENSE_CODE?.trim().toUpperCase();

    if (!systemLicenseCode) {
      return res.status(500).json({
        success: false,
        message: "Super Admin license code is not configured.",
      });
    }

    // Create another Super Admin
    const newSuperAdmin = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      mobile: mobile.trim(),
      role: "super_admin",
      licenseId: null,
      systemLicenseCode,
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

    // 1. Validate pagination
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

    // 2. Find licenses in the master database
    const licenseFilter = {};

    if (status) {
      if (!["active", "suspended", "expired"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid license status.",
        });
      }

      licenseFilter.status = status;
    }

    // Only licenses with successfully provisioned tenant DBs
    licenseFilter.databaseProvisioningStatus = "ready";
    licenseFilter.tenantDbName = { $exists: true, $ne: "" };

    const licenses = await License.find(licenseFilter)
      .select(
        "_id code shopName status expiresAt tenantId tenantDbName maxUsers",
      )
      .lean();

    if (licenses.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        total: 0,
        currentPage,
        totalPages: 0,
        shopAdmins: [],
      });
    }

    // 3. Fetch Shop Admins from each tenant database
    const results = await Promise.all(
      licenses.map(async (license) => {
        try {
          const tenantContext = await getTenantConnection(license.tenantDbName);

          const TenantUser = tenantContext.User;

          const filter = {
            role: "shop_admin",
            licenseId: license._id,
          };

          if (search && search.trim()) {
            const escapedSearch = search
              .trim()
              .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

            filter.$or = [
              { name: { $regex: escapedSearch, $options: "i" } },
              { email: { $regex: escapedSearch, $options: "i" } },
            ];
          }

          const admins = await TenantUser.find(filter)
            .select("-password")
            .lean();

          return admins.map((admin) => ({
            ...admin,
            licenseId: {
              _id: license._id,
              code: license.code,
              shopName: license.shopName,
              status: license.status,
              expiresAt: license.expiresAt,
            },
            tenantId: license.tenantId,
          }));
        } catch (error) {
          console.error(
            `Failed to fetch Shop Admins from ${license.tenantDbName}:`,
            error.message,
          );

          throw error;
        }
      }),
    );

    // 4. Combine all tenant results
    const shopAdmins = results.flat();

    // 5. Sort newest first
    shopAdmins.sort(
      (a, b) =>
        new Date(b.createdAt || 0).getTime() -
        new Date(a.createdAt || 0).getTime(),
    );

    // 6. Apply pagination after combining results
    const total = shopAdmins.length;
    const skip = (currentPage - 1) * perPage;

    const paginatedAdmins = shopAdmins.slice(skip, skip + perPage);

    return res.status(200).json({
      success: true,
      count: paginatedAdmins.length,
      total,
      currentPage,
      totalPages: Math.ceil(total / perPage),
      shopAdmins: paginatedAdmins,
    });
  } catch (error) {
    console.error("Get All Shop Admins error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch Shop Admins from tenant databases.",
    });
  }
};

const getShopAdminById = async (req, res) => {
  try {
    const { id } = req.params;

    // Find the license records that have ready tenant databases
    const licenses = await License.find({
      databaseProvisioningStatus: "ready",
      tenantDbName: { $exists: true, $ne: "" },
    })
      .select(
        "_id code shopName status startDate expiresAt tenantId tenantCode tenantDbName databaseProvisioningStatus",
      )
      .lean();

    // Search for the user in each tenant database
    for (const license of licenses) {
      const tenantContext = await getTenantConnection(license.tenantDbName);

      const TenantUser = tenantContext.User;

      const shopAdmin = await TenantUser.findOne({
        _id: id,
        role: "shop_admin",
        licenseId: license._id,
      })
        .select("-password")
        .lean();

      if (shopAdmin) {
        return res.status(200).json({
          success: true,
          message: "Shop Admin fetched successfully.",
          shopAdmin: {
            ...shopAdmin,
            licenseId: {
              _id: license._id,
              code: license.code,
              shopName: license.shopName,
              status: license.status,
              startDate: license.startDate,
              expiresAt: license.expiresAt,
              tenantCode: license.tenantCode,
              databaseProvisioningStatus: license.databaseProvisioningStatus,
            },
            tenantId: license.tenantId,
          },
        });
      }
    }

    return res.status(404).json({
      success: false,
      message: "Shop Admin not found in any ready tenant database.",
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

    // 2. Find ready tenant databases
    const licenses = await License.find({
      databaseProvisioningStatus: "ready",
      tenantDbName: { $exists: true, $ne: "" },
    })
      .select("_id code shopName status expiresAt tenantId tenantDbName")
      .lean();

    let matchedTenant = null;
    let shopAdmin = null;

    // 3. Find the Shop Admin in tenant databases
    for (const license of licenses) {
      const tenantContext = await getTenantConnection(license.tenantDbName);

      const TenantUser = tenantContext.User;

      const foundUser = await TenantUser.findOne({
        _id: id,
        role: "shop_admin",
        licenseId: license._id,
      }).select("_id");

      if (foundUser) {
        matchedTenant = license;
        shopAdmin = foundUser;
        break;
      }
    }

    if (!shopAdmin || !matchedTenant) {
      return res.status(404).json({
        success: false,
        message: "Shop Admin not found in any ready tenant database.",
      });
    }

    const tenantContext = await getTenantConnection(matchedTenant.tenantDbName);
    const TenantUser = tenantContext.User;

    // 4. Validate and prepare updates
    const updates = {};

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

    if (email !== undefined) {
      if (typeof email !== "string") {
        return res.status(400).json({
          success: false,
          message: "Email must be a string.",
        });
      }

      const normalizedEmail = email.trim().toLowerCase();

      if (
        normalizedEmail.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid email address.",
        });
      }

      const existingUser = await TenantUser.findOne({
        email: normalizedEmail,
        _id: { $ne: id },
      }).select("_id");

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: "This email is already registered in this tenant.",
        });
      }

      updates.email = normalizedEmail;
    }

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

    if (address !== undefined) {
      if (!address || typeof address !== "object" || Array.isArray(address)) {
        return res.status(400).json({
          success: false,
          message: "Address must be an object.",
        });
      }

      const allowedFields = ["street", "city", "state", "pincode", "country"];

      const currentAddress = await TenantUser.findById(id).select("address");

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

    // 5. Do not run an empty update
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide at least one field to update.",
      });
    }

    // 6. Update in the matched tenant database
    const updatedShopAdmin = await TenantUser.findOneAndUpdate(
      {
        _id: id,
        role: "shop_admin",
        licenseId: matchedTenant._id,
      },
      {
        $set: updates,
      },
      {
        new: true,
        runValidators: true,
      },
    ).select(
      "_id name email mobile address role licenseId createdAt updatedAt",
    );

    if (!updatedShopAdmin) {
      return res.status(404).json({
        success: false,
        message: "Shop Admin not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Shop Admin updated successfully.",
      shopAdmin: {
        ...updatedShopAdmin.toObject(),
        licenseId: {
          _id: matchedTenant._id,
          code: matchedTenant.code,
          shopName: matchedTenant.shopName,
          status: matchedTenant.status,
          expiresAt: matchedTenant.expiresAt,
        },
        tenantId: matchedTenant.tenantId,
      },
    });
  } catch (error) {
    console.error("Update Shop Admin error:", error);

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This email is already registered in this tenant.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update Shop Admin.",
    });
  }
};

const deleteShopAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    // 2. Find all ready tenant databases
    const licenses = await License.find({
      databaseProvisioningStatus: "ready",
      tenantDbName: { $exists: true, $ne: "" },
    })
      .select("_id tenantDbName")
      .lean();

    // 3. Search and delete from the matching tenant DB
    for (const license of licenses) {
      const tenantContext = await getTenantConnection(license.tenantDbName);

      const TenantUser = tenantContext.User;

      const deletedAdmin = await TenantUser.findOneAndDelete({
        _id: id,
        role: "shop_admin",
        licenseId: license._id,
      }).select("_id name email role licenseId");

      if (deletedAdmin) {
        return res.status(200).json({
          success: true,
          message: "Shop Admin deleted successfully.",
          deletedAdmin: {
            id: deletedAdmin._id,
            name: deletedAdmin.name,
            email: deletedAdmin.email,
            role: deletedAdmin.role,
            licenseId: deletedAdmin.licenseId,
          },
        });
      }
    }

    // 4. User not found in any ready tenant DB
    return res.status(404).json({
      success: false,
      message: "Shop Admin not found in any ready tenant database.",
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
