// controllers/licenseController.js
const mongoose = require("mongoose");
const License = require("../models/License");
const User = require("../models/User");
const {
  createTenantDbName,
  getTenantConnection,
} = require("../config/tenantDb");
const { getDaysRemaining } = require("../services/licenseService");

const createLicense = async (req, res) => {
  const {
    tenantCode,
    licenseCode,
    licenseName,
    shopName,
    companyEmail,
    contactNumber,
    companyAddress,
    subscriptionPlan,
    billingCycle,
    startDate,
    expiryDate,
    status = "active",
    maxUsers,
    storageLimitGB,
    enabledModules = ["dashboard"],
    tenantAdmin,
    internalNotes = "",
  } = req.body;

  if (
    !tenantCode?.trim() ||
    !licenseCode?.trim() ||
    !licenseName?.trim() ||
    !shopName?.trim() ||
    !companyEmail?.trim() ||
    !subscriptionPlan ||
    !billingCycle ||
    !startDate ||
    !expiryDate ||
    !tenantAdmin?.name?.trim() ||
    !tenantAdmin?.email?.trim() ||
    maxUsers === undefined ||
    storageLimitGB === undefined
  ) {
    return res.status(400).json({
      success: false,
      message: "Please provide all required tenant and license fields.",
    });
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const cleanTenantCode = tenantCode.trim().toUpperCase();
  const cleanLicenseCode = licenseCode.trim().toUpperCase();
  const cleanEmail = companyEmail.trim().toLowerCase();

  if (!/^[A-Z0-9_-]{3,40}$/.test(cleanTenantCode)) {
    return res.status(400).json({
      success: false,
      message:
        "Tenant code must contain 3-40 letters, numbers, hyphens or underscores.",
    });
  }

  if (!emailPattern.test(cleanEmail)) {
    return res.status(400).json({
      success: false,
      message: "Please provide a valid company email.",
    });
  }

  if (!emailPattern.test(tenantAdmin.email.trim())) {
    return res.status(400).json({
      success: false,
      message: "Please provide a valid administrator email.",
    });
  }

  const allowedPlans = ["starter", "professional", "enterprise"];
  const allowedCycles = ["monthly", "yearly", "custom"];
  const allowedStatuses = ["active", "inactive", "pending"];

  const allowedModules = [
    "dashboard",
    "reports",
    "document_management",
    "user_management",
    "analytics",
    "api_access",
  ];

  const start = new Date(startDate);
  const expiry = new Date(expiryDate);
  const users = Number(maxUsers);
  const storage = Number(storageLimitGB);

  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(expiry.getTime()) ||
    expiry <= start
  ) {
    return res.status(400).json({
      success: false,
      message: "Expiry date must be later than the start date.",
    });
  }

  if (
    !allowedPlans.includes(subscriptionPlan) ||
    !allowedCycles.includes(billingCycle) ||
    !allowedStatuses.includes(status)
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid subscription plan, billing cycle or status.",
    });
  }

  if (
    !Number.isSafeInteger(users) ||
    users < 1 ||
    !Number.isFinite(storage) ||
    storage <= 0
  ) {
    return res.status(400).json({
      success: false,
      message: "User limit and storage limit must be valid positive numbers.",
    });
  }

  if (
    !Array.isArray(enabledModules) ||
    enabledModules.some((module) => !allowedModules.includes(module))
  ) {
    return res.status(400).json({
      success: false,
      message: "One or more enabled modules are invalid.",
    });
  }

  try {
    const duplicate = await License.findOne({
      $or: [{ tenantCode: cleanTenantCode }, { code: cleanLicenseCode }],
    }).lean();

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "Tenant code or license code already exists.",
      });
    }

    const tenantId = new mongoose.Types.ObjectId();
    const licenseId = new mongoose.Types.ObjectId();

    const tenantDbName = createTenantDbName(cleanTenantCode, tenantId);

    const tenantDocumentPrefix = `tenants/${tenantId.toString()}/licenses/${licenseId.toString()}/`;

    // Only the server generates tenant/database identifiers.
    const license = await License.create({
      _id: licenseId,
      tenantId,
      tenantCode: cleanTenantCode,
      code: cleanLicenseCode,
      licenseName: licenseName.trim(),
      shopName: shopName.trim(),
      companyEmail: cleanEmail,
      contactNumber: contactNumber?.trim() || "",
      companyAddress: companyAddress?.trim() || "",
      subscriptionPlan,
      billingCycle,
      startDate: start,
      expiresAt: expiry,
      status,
      maxUsers: users,
      storageLimitGB: storage,
      enabledModules: [...new Set(enabledModules)],
      tenantAdmin: {
        name: tenantAdmin.name.trim(),
        email: tenantAdmin.email.trim().toLowerCase(),
        contactNumber: tenantAdmin.contactNumber?.trim() || "",
      },
      tenantDbName,
      databaseProvisioningStatus: "provisioning",
      documentStorageType: "mongodb_gridfs",
      tenantDocumentPrefix,
      internalNotes: internalNotes.trim(),
      createdBy: req.user.id,
    });

    try {
      const { connection, TenantLicense, TenantProfile } =
        await getTenantConnection(tenantDbName);

      // Writing these records creates the tenant database and collections.
      await TenantProfile.findOneAndUpdate(
        { tenantId, licenseId },
        {
          $set: {
            tenantCode: cleanTenantCode,
            shopName: shopName.trim(),
            companyEmail: cleanEmail,
            companyAddress: companyAddress?.trim() || "",
          },
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        },
      );

      await TenantLicense.findOneAndUpdate(
        { tenantId, licenseId },
        {
          $set: {
            licenseCode: cleanLicenseCode,
            licenseName: licenseName.trim(),
            status,
            startDate: start,
            expiresAt: expiry,
            subscriptionPlan,
            billingCycle,
            maxUsers: users,
            storageLimitGB: storage,
            enabledModules: [...new Set(enabledModules)],
          },
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        },
      );

      // Ensure the tenant database is available before reporting success.
      await connection.db.command({ ping: 1 });

      license.databaseProvisioningStatus = "ready";
      license.databaseCreatedAt = new Date();
      await license.save();

      return res.status(201).json({
        success: true,
        message: "Tenant and license created successfully.",
        license: {
          id: license._id,
          tenantId: license.tenantId,
          tenantCode: license.tenantCode,
          code: license.code,
          shopName: license.shopName,
          tenantDbName: license.tenantDbName,
          status: license.status,
          databaseProvisioningStatus: license.databaseProvisioningStatus,
          databaseCreatedAt: license.databaseCreatedAt,
          tenantDocumentPrefix: license.tenantDocumentPrefix,
          expiresAt: license.expiresAt,
        },
      });
    } catch (provisionError) {
      console.error("Tenant provisioning failed:", provisionError);

      license.databaseProvisioningStatus = "failed";
      await license.save();

      return res.status(503).json({
        success: false,
        message:
          "License was recorded, but tenant database provisioning failed. Retry provisioning before using this tenant.",
        licenseId: license._id,
        databaseProvisioningStatus: "failed",
      });
    }
  } catch (error) {
    console.error("Create tenant/license error:", error);

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Tenant code or license code already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create tenant license.",
    });
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
    const licenses = await License.find({
      status: "active",
      databaseProvisioningStatus: "ready",
    })
      .select("_id code shopName expiresAt tenantDbName")
      .sort({ createdAt: -1 })
      .lean();

    const availabilityResults = await Promise.all(
      licenses.map(async (license) => {
        try {
          if (!license.tenantDbName) {
            return { license, available: false };
          }

          const tenantContext = await getTenantConnection(license.tenantDbName);

          const TenantUser = tenantContext.User;

          const assignedAdmin = await TenantUser.exists({
            role: "shop_admin",
            licenseId: license._id,
          });

          return {
            license,
            available: !assignedAdmin,
          };
        } catch (error) {
          // If a tenant cannot be checked, do not expose
          // its license as available.
          console.error(
            `Failed to check license ${license.code}:`,
            error.message,
          );

          return { license, available: false };
        }
      }),
    );

    const availableLicenses = availabilityResults
      .filter((result) => result.available)
      .map(({ license }) => ({
        _id: license._id,
        code: license.code,
        shopName: license.shopName,
        expiresAt: license.expiresAt,
      }));

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
  let license;
  let tenantLicenseBeforeUpdate;
  let TenantLicense;
  let tenantUpdated = false;

  try {
    const { id } = req.params;
    const { durationMonths } = req.body;

    // 1. Validate license ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid license ID.",
      });
    }

    // 2. Validate renewal duration
    const months = Number(durationMonths);

    if (!Number.isInteger(months) || months < 1 || months > 120) {
      return res.status(400).json({
        success: false,
        message: "Renewal duration must be between 1 and 120 months.",
      });
    }

    // 3. Find license in the master database
    license = await License.findById(id);

    if (!license) {
      return res.status(404).json({
        success: false,
        message: "License not found.",
      });
    }

    // 4. Only renew licenses with a ready tenant database
    if (
      license.databaseProvisioningStatus !== "ready" ||
      !license.tenantDbName ||
      !license.tenantId
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Tenant database is not ready. Complete provisioning before renewing this license.",
      });
    }

    // 5. Calculate the new expiry date.
    // Preserve remaining validity when renewing early.
    // For expired licenses, start from today.
    const now = new Date();

    const currentExpiry = license.expiresAt
      ? new Date(license.expiresAt)
      : null;

    const renewalStart =
      currentExpiry && currentExpiry > now ? currentExpiry : now;

    // Clamp the day to the last valid day of the target month.
    // Example: January 31 + 1 month = February 28/29.
    const newExpiry = new Date(renewalStart);
    const originalDay = newExpiry.getDate();

    newExpiry.setDate(1);
    newExpiry.setMonth(newExpiry.getMonth() + months);

    const lastDayOfTargetMonth = new Date(
      newExpiry.getFullYear(),
      newExpiry.getMonth() + 1,
      0,
    ).getDate();

    newExpiry.setDate(Math.min(originalDay, lastDayOfTargetMonth));

    // 6. Connect to the tenant database
    const tenantContext = await getTenantConnection(license.tenantDbName);

    const { connection } = tenantContext;
    TenantLicense = tenantContext.TenantLicense;

    await connection.db.command({ ping: 1 });

    const identity = {
      tenantId: license.tenantId,
      licenseId: license._id,
    };

    // 7. Ensure the tenant-side license exists
    tenantLicenseBeforeUpdate = await TenantLicense.findOne(identity).lean();

    if (!tenantLicenseBeforeUpdate) {
      return res.status(409).json({
        success: false,
        message:
          "Tenant license record is missing. Repair tenant provisioning before renewing.",
      });
    }

    // 8. Update the tenant database first
    const tenantLicense = await TenantLicense.findOneAndUpdate(
      identity,
      {
        $set: {
          expiresAt: newExpiry,
          status: "active",
        },
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!tenantLicense) {
      return res.status(409).json({
        success: false,
        message: "Tenant license could not be updated.",
      });
    }

    tenantUpdated = true;

    // 9. Update the master database
    license.expiresAt = newExpiry;
    license.status = "active";

    await license.save();

    // 10. Return the updated license
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

    // Best-effort rollback if the master update fails
    // after the tenant update has succeeded.
    if (
      tenantUpdated &&
      TenantLicense &&
      license &&
      tenantLicenseBeforeUpdate
    ) {
      try {
        const identity = {
          tenantId: license.tenantId,
          licenseId: license._id,
        };

        await TenantLicense.updateOne(
          identity,
          {
            $set: {
              expiresAt: tenantLicenseBeforeUpdate.expiresAt,
              status: tenantLicenseBeforeUpdate.status,
            },
          },
          { runValidators: true },
        );
      } catch (rollbackError) {
        console.error("Renew license rollback failed:", rollbackError);
      }
    }

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A license with conflicting data already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to renew license.",
    });
  }
};

const updateLicense = async (req, res) => {
  let license;
  let originalData;
  let tenantContext;
  let tenantProfileUpdated = false;
  let tenantLicenseUpdated = false;
  let originalProfile;
  let originalTenantLicense;

  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid license ID.",
      });
    }

    license = await License.findById(id);

    if (!license) {
      return res.status(404).json({
        success: false,
        message: "License not found.",
      });
    }

    if (license.databaseProvisioningStatus !== "ready") {
      return res.status(409).json({
        success: false,
        message: "Only licenses with ready tenant databases can be edited.",
      });
    }

    if (!license.tenantDbName || !license.tenantId) {
      return res.status(400).json({
        success: false,
        message: "License is missing tenant database information.",
      });
    }

    const body = req.body;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const allowedPlans = ["starter", "professional", "enterprise"];
    const allowedCycles = ["monthly", "yearly", "custom"];
    const allowedStatuses = [
      "active",
      "inactive",
      "pending",
      "suspended",
      "expired",
    ];

    const allowedModules = [
      "dashboard",
      "reports",
      "document_management",
      "user_management",
      "analytics",
      "api_access",
    ];

    const updates = {};

    const stringFields = [
      "tenantCode",
      "licenseCode",
      "licenseName",
      "shopName",
      "companyEmail",
      "contactNumber",
      "companyAddress",
      "subscriptionPlan",
      "billingCycle",
      "startDate",
      "expiryDate",
      "status",
      "maxUsers",
      "storageLimitGB",
      "enabledModules",
      "tenantAdmin",
      "internalNotes",
    ];

    // Only allow fields supported by the edit form.
    const allowedFields = new Set(stringFields);

    for (const key of Object.keys(body)) {
      if (!allowedFields.has(key)) {
        return res.status(400).json({
          success: false,
          message: `Field "${key}" cannot be updated.`,
        });
      }
    }

    const cleanString = (value) =>
      typeof value === "string" ? value.trim() : "";

    if (body.tenantCode !== undefined) {
      const tenantCode = cleanString(body.tenantCode).toUpperCase();

      if (!/^[A-Z0-9_-]{3,40}$/.test(tenantCode)) {
        return res.status(400).json({
          success: false,
          message: "Invalid tenant code.",
        });
      }

      const duplicate = await License.findOne({
        tenantCode,
        _id: { $ne: license._id },
      }).lean();

      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: "Tenant code already exists.",
        });
      }

      updates.tenantCode = tenantCode;
    }

    if (body.licenseCode !== undefined) {
      const licenseCode = cleanString(body.licenseCode).toUpperCase();

      if (!/^[A-Z0-9-]{3,100}$/.test(licenseCode)) {
        return res.status(400).json({
          success: false,
          message: "Invalid license code.",
        });
      }

      const duplicate = await License.findOne({
        code: licenseCode,
        _id: { $ne: license._id },
      }).lean();

      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: "License code already exists.",
        });
      }

      updates.code = licenseCode;
    }

    if (body.licenseName !== undefined) {
      const value = cleanString(body.licenseName);

      if (value.length < 2 || value.length > 150) {
        return res.status(400).json({
          success: false,
          message: "License name must contain 2–150 characters.",
        });
      }

      updates.licenseName = value;
    }

    if (body.shopName !== undefined) {
      const value = cleanString(body.shopName);

      if (
        value.length < 2 ||
        value.length > 150 ||
        !/^[a-zA-Z0-9\s&'().-]+$/.test(value)
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid shop name.",
        });
      }

      updates.shopName = value;
    }

    if (body.companyEmail !== undefined) {
      const value = cleanString(body.companyEmail).toLowerCase();

      if (!emailPattern.test(value)) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid company email.",
        });
      }

      updates.companyEmail = value;
    }

    if (body.contactNumber !== undefined) {
      if (typeof body.contactNumber !== "string") {
        return res.status(400).json({
          success: false,
          message: "Invalid contact number.",
        });
      }

      updates.contactNumber = body.contactNumber.trim();
    }

    if (body.companyAddress !== undefined) {
      if (typeof body.companyAddress !== "string") {
        return res.status(400).json({
          success: false,
          message: "Invalid company address.",
        });
      }

      updates.companyAddress = body.companyAddress.trim();
    }

    if (body.subscriptionPlan !== undefined) {
      if (!allowedPlans.includes(body.subscriptionPlan)) {
        return res.status(400).json({
          success: false,
          message: "Invalid subscription plan.",
        });
      }

      updates.subscriptionPlan = body.subscriptionPlan;
    }

    if (body.billingCycle !== undefined) {
      if (!allowedCycles.includes(body.billingCycle)) {
        return res.status(400).json({
          success: false,
          message: "Invalid billing cycle.",
        });
      }

      updates.billingCycle = body.billingCycle;
    }

    if (body.startDate !== undefined) {
      const value = new Date(body.startDate);

      if (!Number.isFinite(value.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid start date.",
        });
      }

      updates.startDate = value;
    }

    if (body.expiryDate !== undefined) {
      const value = new Date(body.expiryDate);

      if (!Number.isFinite(value.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid expiry date.",
        });
      }

      updates.expiresAt = value;
    }

    if (body.status !== undefined) {
      if (!allowedStatuses.includes(body.status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid license status.",
        });
      }

      updates.status = body.status;
    }

    if (body.maxUsers !== undefined) {
      const value = Number(body.maxUsers);

      if (!Number.isSafeInteger(value) || value < 1) {
        return res.status(400).json({
          success: false,
          message: "Maximum users must be a positive whole number.",
        });
      }

      updates.maxUsers = value;
    }

    if (body.storageLimitGB !== undefined) {
      const value = Number(body.storageLimitGB);

      if (!Number.isFinite(value) || value < 1) {
        return res.status(400).json({
          success: false,
          message: "Storage limit must be at least 1 GB.",
        });
      }

      updates.storageLimitGB = value;
    }

    if (body.enabledModules !== undefined) {
      if (
        !Array.isArray(body.enabledModules) ||
        body.enabledModules.some(
          (module) =>
            typeof module !== "string" || !allowedModules.includes(module),
        )
      ) {
        return res.status(400).json({
          success: false,
          message: "One or more enabled modules are invalid.",
        });
      }

      updates.enabledModules = [...new Set(body.enabledModules)];
    }

    if (body.tenantAdmin !== undefined) {
      const admin = body.tenantAdmin;

      if (!admin || typeof admin !== "object" || Array.isArray(admin)) {
        return res.status(400).json({
          success: false,
          message: "Invalid tenant administrator details.",
        });
      }

      const name = cleanString(admin.name);
      const email = cleanString(admin.email).toLowerCase();
      const contactNumber = cleanString(admin.contactNumber);

      if (name.length < 2 || name.length > 100) {
        return res.status(400).json({
          success: false,
          message: "Administrator name must contain 2–100 characters.",
        });
      }

      if (!emailPattern.test(email)) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid administrator email.",
        });
      }

      updates.tenantAdmin = {
        name,
        email,
        contactNumber,
      };
    }

    if (body.internalNotes !== undefined) {
      if (typeof body.internalNotes !== "string") {
        return res.status(400).json({
          success: false,
          message: "Internal notes must be text.",
        });
      }

      updates.internalNotes = body.internalNotes.trim();
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one field to update.",
      });
    }

    const nextStart = updates.startDate ?? license.startDate;
    const nextExpiry = updates.expiresAt ?? license.expiresAt;

    if (
      !nextStart ||
      !nextExpiry ||
      new Date(nextExpiry) <= new Date(nextStart)
    ) {
      return res.status(400).json({
        success: false,
        message: "Expiry date must be later than the start date.",
      });
    }

    // Snapshot the master record for best-effort compensation.
    originalData = license.toObject();

    // Connect to the existing tenant database.
    tenantContext = await getTenantConnection(license.tenantDbName);

    const { connection, TenantLicense, TenantProfile } = tenantContext;

    await connection.db.command({ ping: 1 });

    const identity = {
      tenantId: license.tenantId,
      licenseId: license._id,
    };

    originalProfile = await TenantProfile.findOne(identity).lean();
    originalTenantLicense = await TenantLicense.findOne(identity).lean();

    if (!originalProfile || !originalTenantLicense) {
      return res.status(409).json({
        success: false,
        message:
          "Tenant profile or tenant license record is missing. Repair tenant provisioning before editing.",
      });
    }

    // Update master record in memory, then validate before saving.
    Object.assign(license, updates);
    await license.validate();

    // Synchronize tenant-side records.
    await TenantProfile.findOneAndUpdate(
      identity,
      {
        $set: {
          tenantCode: license.tenantCode,
          shopName: license.shopName,
          companyEmail: license.companyEmail,
          companyAddress: license.companyAddress || "",
        },
      },
      { new: true, runValidators: true },
    );

    tenantProfileUpdated = true;

    await TenantLicense.findOneAndUpdate(
      identity,
      {
        $set: {
          licenseCode: license.code,
          licenseName: license.licenseName,
          status: license.status,
          startDate: license.startDate,
          expiresAt: license.expiresAt,
          subscriptionPlan: license.subscriptionPlan,
          billingCycle: license.billingCycle,
          maxUsers: license.maxUsers,
          storageLimitGB: license.storageLimitGB,
          enabledModules: license.enabledModules,
        },
      },
      { new: true, runValidators: true },
    );

    tenantLicenseUpdated = true;

    await license.save();

    return res.status(200).json({
      success: true,
      message: "License updated successfully.",
      license: license.toObject(),
    });
  } catch (error) {
    console.error("Update license error:", error);

    // Best-effort compensation if synchronization or master save fails.
    try {
      if (tenantContext && license && originalData) {
        const { TenantLicense, TenantProfile } = tenantContext;

        const identity = {
          tenantId: license.tenantId,
          licenseId: license._id,
        };

        if (tenantProfileUpdated && originalProfile) {
          const { _id, ...profileData } = originalProfile;

          await TenantProfile.findOneAndUpdate(
            identity,
            { $set: profileData },
            { runValidators: true },
          );
        }

        if (tenantLicenseUpdated && originalTenantLicense) {
          const { _id, ...tenantLicenseData } = originalTenantLicense;

          await TenantLicense.findOneAndUpdate(
            identity,
            { $set: tenantLicenseData },
            { runValidators: true },
          );
        }

        if (license.isNew === false) {
          // Restore only editable master fields from the snapshot.
          const restoreFields = [
            "tenantCode",
            "code",
            "licenseName",
            "shopName",
            "companyEmail",
            "contactNumber",
            "companyAddress",
            "subscriptionPlan",
            "billingCycle",
            "startDate",
            "expiresAt",
            "status",
            "maxUsers",
            "storageLimitGB",
            "enabledModules",
            "tenantAdmin",
            "internalNotes",
          ];

          const restore = {};

          for (const field of restoreFields) {
            if (originalData[field] !== undefined) {
              restore[field] = originalData[field];
            }
          }

          await License.updateOne(
            { _id: license._id },
            { $set: restore },
            { runValidators: true },
          );
        }
      }
    } catch (rollbackError) {
      console.error("License update compensation failed:", rollbackError);
    }

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Tenant code or license code already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Failed to update license. Check tenant database connectivity and logs.",
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

const retryProvisioning = async (req, res) => {
  let license;

  try {
    const { id } = req.params;

    // 1. Validate license ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid license ID.",
      });
    }

    // 2. Only retry a license that previously failed
    license = await License.findOneAndUpdate(
      {
        _id: id,
        databaseProvisioningStatus: "failed",
      },
      {
        $set: {
          databaseProvisioningStatus: "provisioning",
        },
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!license) {
      const existingLicense = await License.findById(id).lean();

      if (!existingLicense) {
        return res.status(404).json({
          success: false,
          message: "License not found.",
        });
      }

      return res.status(409).json({
        success: false,
        message: "Only licenses with failed provisioning can be retried.",
        databaseProvisioningStatus: existingLicense.databaseProvisioningStatus,
      });
    }

    // 3. Reuse the original tenant and database identifiers
    if (
      !license.tenantId ||
      !license.tenantDbName ||
      !license.tenantCode ||
      !license.code
    ) {
      throw new Error("License is missing required tenant provisioning data.");
    }

    // 4. Connect to the existing tenant database
    const { connection, TenantLicense, TenantProfile } =
      await getTenantConnection(license.tenantDbName);

    // 5. Recreate/update the tenant profile idempotently
    await TenantProfile.findOneAndUpdate(
      {
        tenantId: license.tenantId,
        licenseId: license._id,
      },
      {
        $set: {
          tenantCode: license.tenantCode,
          shopName: license.shopName,
          companyEmail: license.companyEmail,
          companyAddress: license.companyAddress || "",
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    // 6. Recreate/update the tenant-side license record
    await TenantLicense.findOneAndUpdate(
      {
        tenantId: license.tenantId,
        licenseId: license._id,
      },
      {
        $set: {
          licenseCode: license.code,
          licenseName: license.licenseName,
          status: license.status,
          startDate: license.startDate,
          expiresAt: license.expiresAt,
          subscriptionPlan: license.subscriptionPlan,
          billingCycle: license.billingCycle,
          maxUsers: license.maxUsers,
          storageLimitGB: license.storageLimitGB,
          enabledModules: license.enabledModules,
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    // 7. Confirm that the tenant database is reachable
    await connection.db.command({ ping: 1 });

    // 8. Mark provisioning as ready only after all steps succeed
    license.databaseProvisioningStatus = "ready";
    license.databaseCreatedAt = license.databaseCreatedAt || new Date();

    await license.save();

    return res.status(200).json({
      success: true,
      message: "Tenant provisioning retry completed successfully.",
      license: {
        id: license._id,
        tenantId: license.tenantId,
        tenantCode: license.tenantCode,
        code: license.code,
        tenantDbName: license.tenantDbName,
        databaseProvisioningStatus: license.databaseProvisioningStatus,
        databaseCreatedAt: license.databaseCreatedAt,
      },
    });
  } catch (error) {
    console.error("Retry tenant provisioning failed:", error);

    // Keep the original license and IDs for the next retry
    if (license) {
      try {
        await License.updateOne(
          {
            _id: license._id,
            databaseProvisioningStatus: "provisioning",
          },
          {
            $set: {
              databaseProvisioningStatus: "failed",
            },
          },
        );
      } catch (statusError) {
        console.error("Failed to update provisioning status:", statusError);
      }
    }

    return res.status(503).json({
      success: false,
      message:
        "Tenant provisioning failed. You can retry using the same license ID.",
      licenseId: license?._id,
      databaseProvisioningStatus: "failed",
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
  retryProvisioning,
};
