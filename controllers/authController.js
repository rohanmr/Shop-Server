// backend/controllers/authController.js
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { redisClient } = require("../config/redis");
const { sendOTPEmail } = require("../services/emailService");
const { getLicenseAccessStatus } = require("../services/licenseService");

const hashOTP = (otp) => crypto.createHash("sha256").update(otp).digest("hex");

exports.initiateLogin = async (req, res) => {
  const { licenseCode, email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: "Provide email and password." });

  try {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({
      email: normalizedEmail,
    }).populate("licenseId");

    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    // Validate License Rules for Shop Admins
    if (user.role === "shop_admin") {
      if (!licenseCode)
        return res.status(400).json({ message: "License parameters missing." });
      if (
        !user.licenseId ||
        user.licenseId.code !== licenseCode.trim().toUpperCase()
      ) {
        return res
          .status(401)
          .json({ message: "License credentials mismatch." });
      }
      
    }

    // Check expiry and status against the database.
    const licenseAccess = await getLicenseAccessStatus(user._id);

    if (!licenseAccess.allowed) {
      return res.status(licenseAccess.statusCode).json({
        success: false,
        message: licenseAccess.message,
        code: licenseAccess.message.startsWith("License expired.")
          ? "LICENSE_EXPIRED"
          : undefined,
      });
    }

    const passMatch = await bcrypt.compare(password, user.password);
    if (!passMatch)
      return res.status(401).json({ message: "Invalid credentials" });

    // Enforce 60-second cooldown rate throttle block
    const cooldownKey = `otp:cooldown:${email}`;
    const pendingKey = `otp:pending:${email}`;
    if (await redisClient.exists(cooldownKey)) {
      return res
        .status(429)
        .json({ message: "Wait 1 minute before resending a new OTP request." });
    }

    const rawOtp = crypto.randomInt(100000, 1000000).toString();
    const encodedOtp = hashOTP(rawOtp);

    await redisClient.set(`otp:auth:${email}`, encodedOtp, { EX: 180 }); // 3 Min OTP Expiry
    await redisClient.set(cooldownKey, "active", { EX: 60 }); // 1 Min Cooldown Reset
    await redisClient.set(pendingKey, "1", { EX: 600 });

    console.log(`[OTP Send on Email] OTP for ${email} is -> [ ${rawOtp} ]`);
    // await sendOTPEmail(normalizedEmail, rawOtp);

    const expiresIn = await redisClient.ttl(`otp:auth:${email}`);
    const resendIn = await redisClient.ttl(`otp:cooldown:${email}`);

    return res.status(200).json({
      success: true,
      message: "OTP generated successfully.",
      email,
      expiresIn,
      resendIn,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Server context execution runtime error.",
      error: err.message,
    });
  }
};

exports.verifyOTP = async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp)
    return res.status(400).json({ message: "Data fields missing." });

  try {
    const cachedHash = await redisClient.get(`otp:auth:${email}`);
    if (!cachedHash)
      return res.status(400).json({ message: "OTP expired. Resend code." });

    if (hashOTP(otp) !== cachedHash)
      return res.status(401).json({ message: "OTP Incorrect" });

    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    });

    if (!user) {
      await redisClient.del(`otp:auth:${email}`);
      return res.status(401).json({
        message: "User not found. Please initiate login again.",
      });
    }

    const sessionToken = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN },
    );

    await redisClient.del(`otp:auth:${email}`);
    await redisClient.del(`otp:cooldown:${email}`);
    await redisClient.del(`otp:pending:${email}`);

    return res.status(200).json({
      token: sessionToken,
      user: { name: user.name, role: user.role },
    });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Verification transaction engine failure." });
  }
};

exports.resendOTP = async (req, res) => {
  const normalizedEmail = req.body.email?.trim().toLowerCase();

  if (!normalizedEmail) {
    return res.status(400).json({
      success: false,
      message: "Email address is required.",
    });
  }

  try {
    // A login attempt must have passed the initial checks first.
    const pending = await redisClient.get(`otp:pending:${normalizedEmail}`);

    if (!pending) {
      return res.status(400).json({
        success: false,
        message: "Login session expired. Please login again.",
      });
    }

    // Enforce resend cooldown
    const cooldownKey = `otp:cooldown:${normalizedEmail}`;
    const remainingCooldown = await redisClient.ttl(cooldownKey);

    if (remainingCooldown > 0) {
      return res.status(429).json({
        success: false,
        message: `Please wait ${remainingCooldown} seconds before requesting another OTP.`,
        resendIn: remainingCooldown,
      });
    }

    // Generate a new OTP
    const rawOtp = crypto.randomInt(100000, 1000000).toString();
    const encodedOtp = hashOTP(rawOtp);
    const otpKey = `otp:auth:${normalizedEmail}`;

    console.log(
      `[OTP ReSend on Email] OTP for ${normalizedEmail} is -> [ ${rawOtp} ]`,
    );

    // Email first; do not invalidate the previous OTP if email delivery fails.
    // await sendOTPEmail(normalizedEmail, rawOtp);

    // Replace the old OTP with the new one
    await redisClient.set(otpKey, encodedOtp, { EX: 180 });
    await redisClient.set(cooldownKey, "1", { EX: 30 });

    return res.status(200).json({
      success: true,
      message: "A new OTP has been sent to your email.",
      expiresIn: 180,
      resendIn: 30,
    });
  } catch (error) {
    console.error("Resend OTP error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to send OTP. Please try again later.",
    });
  }
};
