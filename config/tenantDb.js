const mongoose = require("mongoose");
const User = require("../models/User");

const connections = new Map();

const createTenantDbName = (tenantCode, tenantId) => {
  const slug = tenantCode
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 35);

  return `tenant_${slug || "shop"}_${String(tenantId)
    .replace(/[^a-f0-9]/gi, "")
    .slice(-8)
    .toLowerCase()}`;
};

// const getTenantConnection = async (databaseName) => {
//   if (
//     typeof databaseName !== "string" ||
//     !/^tenant_[a-z0-9_]+$/.test(databaseName)
//   ) {
//     throw new Error("Invalid tenant database name.");
//   }

//   const cached = connections.get(databaseName);

//   if (cached) {
//     try {
//       return await cached;
//     } catch {
//       connections.delete(databaseName);
//     }
//   }

//   const pendingConnection = mongoose
//     .createConnection(process.env.MONGO_URI, {
//       dbName: databaseName,
//       serverSelectionTimeoutMS: 10000,
//     })
//     .asPromise();

//   connections.set(databaseName, pendingConnection);

//   try {
//     const connection = await pendingConnection;

//     connection.model("User", User.UserSchema);

//     const TenantLicenseSchema = new mongoose.Schema(
//       {
//         tenantId: {
//           type: mongoose.Schema.Types.ObjectId,
//           required: true,
//           index: true,
//         },
//         licenseId: {
//           type: mongoose.Schema.Types.ObjectId,
//           required: true,
//           unique: true,
//           index: true,
//         },
//         licenseCode: { type: String, required: true },
//         licenseName: { type: String, required: true },
//         status: { type: String, required: true },
//         startDate: { type: Date, required: true },
//         expiresAt: { type: Date, required: true },
//         subscriptionPlan: { type: String, required: true },
//         billingCycle: { type: String, required: true },
//         maxUsers: { type: Number, required: true },
//         storageLimitGB: { type: Number, required: true },
//         enabledModules: { type: [String], default: [] },
//       },
//       { timestamps: true },
//     );

//     const TenantProfileSchema = new mongoose.Schema(
//       {
//         tenantId: {
//           type: mongoose.Schema.Types.ObjectId,
//           required: true,
//           unique: true,
//           index: true,
//         },
//         licenseId: {
//           type: mongoose.Schema.Types.ObjectId,
//           required: true,
//           unique: true,
//           index: true,
//         },
//         tenantCode: { type: String, required: true },
//         shopName: { type: String, required: true },
//         companyEmail: { type: String, required: true },
//         companyAddress: { type: String, default: "" },
//       },
//       { timestamps: true },
//     );

//     const TenantLicense = connection.model(
//       "TenantLicense",
//       TenantLicenseSchema,
//     );

//     const TenantProfile = connection.model(
//       "TenantProfile",
//       TenantProfileSchema,
//     );

//     console.log(`Tenant DB connected: ${databaseName}`);

//     return { connection, TenantLicense, TenantProfile };
//   } catch (error) {
//     connections.delete(databaseName);
//     throw error;
//   }
// };

const getTenantConnection = async (databaseName) => {
  if (
    typeof databaseName !== "string" ||
    !/^tenant_[a-z0-9_]+$/.test(databaseName)
  ) {
    throw new Error("Invalid tenant database name.");
  }

  // Cache the fully initialized tenant context, not just
  // the raw MongoDB connection promise.
  const cached = connections.get(databaseName);

  if (cached) {
    try {
      return await cached;
    } catch {
      connections.delete(databaseName);
    }
  }

  const pendingContext = (async () => {
    let connection;

    try {
      connection = await mongoose
        .createConnection(process.env.MONGO_URI, {
          dbName: databaseName,
          serverSelectionTimeoutMS: 10000,
        })
        .asPromise();

      connection.model("User", User.UserSchema);

      const TenantLicenseSchema = new mongoose.Schema(
        {
          tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
          },
          licenseId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            unique: true,
            index: true,
          },
          licenseCode: { type: String, required: true },
          licenseName: { type: String, required: true },
          status: { type: String, required: true },
          startDate: { type: Date, required: true },
          expiresAt: { type: Date, required: true },
          subscriptionPlan: { type: String, required: true },
          billingCycle: { type: String, required: true },
          maxUsers: { type: Number, required: true },
          storageLimitGB: { type: Number, required: true },
          enabledModules: { type: [String], default: [] },
        },
        { timestamps: true },
      );

      const TenantProfileSchema = new mongoose.Schema(
        {
          tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            unique: true,
            index: true,
          },
          licenseId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            unique: true,
            index: true,
          },
          tenantCode: { type: String, required: true },
          shopName: { type: String, required: true },
          companyEmail: { type: String, required: true },
          companyAddress: { type: String, default: "" },
        },
        { timestamps: true },
      );

      const TenantLicense = connection.model(
        "TenantLicense",
        TenantLicenseSchema,
      );

      const TenantProfile = connection.model(
        "TenantProfile",
        TenantProfileSchema,
      );

      console.log(`Tenant DB connected: ${databaseName}`);

      return {
        connection,
        TenantLicense,
        TenantProfile,
        User: connection.model("User"),
      };
    } catch (error) {
      if (connection) {
        await connection.close().catch(() => {});
      }

      throw error;
    }
  })();

  connections.set(databaseName, pendingContext);

  try {
    return await pendingContext;
  } catch (error) {
    if (connections.get(databaseName) === pendingContext) {
      connections.delete(databaseName);
    }

    throw error;
  }
};

module.exports = {
  createTenantDbName,
  getTenantConnection,
};
