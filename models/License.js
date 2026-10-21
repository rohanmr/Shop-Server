// backend/models/License.js
const mongoose = require("mongoose");
const LicenseSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    shopName: { type: String, required: true },
    status: {
      type: String,
      enum: ["active", "suspended", "expired"],
      default: "active",
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
module.exports = mongoose.model("License", LicenseSchema);
