require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"),
});

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const User = require("../models/User");

async function seedSuperAdmin() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is missing from .env");
    }

    if (!process.env.SUPER_ADMIN_EMAIL || !process.env.SUPER_ADMIN_PASSWORD) {
      throw new Error(
        "SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required",
      );
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("Database connected.");

    const email = process.env.SUPER_ADMIN_EMAIL.trim().toLowerCase();
    const mobile = process.env.SUPER_ADMIN_MOBILE;

    // Do not create a duplicate administrator.
    const existingAdmin = await User.findOne({ email });

    if (existingAdmin) {
      console.log(
        "An account with this email already exists. No changes made.",
      );
      return;
    }

    const password = await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD, 12);

    await User.create({
      name: "Super Admin",
      email,
      mobile,
      password,
      role: "super_admin",
      licenseId: null,
      systemLicenseCode:
        process.env.SUPER_ADMIN_LICENSE_CODE.trim().toUpperCase(),
    });

    console.log("Super Admin created successfully.");
  } catch (error) {
    console.error("Super Admin seeding failed:", error.message);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

seedSuperAdmin();
