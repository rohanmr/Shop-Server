const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    mobile: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      street: { type: String, trim: true, default: "" },
      city: { type: String, trim: true, default: "" },
      state: { type: String, trim: true, default: "" },
      pincode: { type: String, trim: true, default: "" },
      country: { type: String, trim: true, default: "India" },
    },
    profileImage: {
      type: String,
      default: "",
    },

    password: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      enum: ["super_admin", "shop_admin"],
      required: true,
    },

    licenseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "License",
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Existing controllers continue using the master DB model.
const User = mongoose.models.User || mongoose.model("User", UserSchema);

// Tenant connections can compile the same schema separately.
User.UserSchema = UserSchema;

module.exports = User;
