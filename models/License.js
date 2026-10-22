const mongoose = require("mongoose");

const LicenseSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      immutable: true,
      index: true,
    },

    tenantCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },

    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },

    licenseName: {
      type: String,
      required: true,
      trim: true,
    },

    shopName: {
      type: String,
      required: true,
      trim: true,
    },

    companyEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    contactNumber: {
      type: String,
      trim: true,
      default: "",
    },

    companyAddress: {
      type: String,
      trim: true,
      default: "",
    },

    subscriptionPlan: {
      type: String,
      enum: ["starter", "professional", "enterprise"],
      required: true,
    },

    billingCycle: {
      type: String,
      enum: ["monthly", "yearly", "custom"],
      required: true,
    },

    startDate: {
      type: Date,
      required: true,
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    status: {
      type: String,
      enum: ["active", "inactive", "pending", "suspended", "expired"],
      default: "pending",
    },

    maxUsers: {
      type: Number,
      required: true,
      min: 1,
    },

    storageLimitGB: {
      type: Number,
      required: true,
      min: 1,
    },

    enabledModules: {
      type: [
        {
          type: String,
          enum: [
            "dashboard",
            "reports",
            "document_management",
            "user_management",
            "analytics",
            "api_access",
          ],
        },
      ],
      default: ["dashboard"],
    },

    tenantAdmin: {
      name: { type: String, required: true, trim: true },
      email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
      },
      contactNumber: { type: String, trim: true, default: "" },
    },

    tenantDbName: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
    },

    databaseProvisioningStatus: {
      type: String,
      enum: ["provisioning", "ready", "failed"],
      default: "provisioning",
    },

    databaseCreatedAt: {
      type: Date,
      default: null,
    },

    documentStorageType: {
      type: String,
      enum: ["mongodb_gridfs", "object_storage"],
      default: "mongodb_gridfs",
    },

    tenantDocumentPrefix: {
      type: String,
      required: true,
      immutable: true,
    },

    internalNotes: {
      type: String,
      trim: true,
      default: "",
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("License", LicenseSchema);
