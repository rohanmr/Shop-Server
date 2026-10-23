const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const MasterUser = require("../models/User");
const License = require("../models/License");
const { getTenantConnection } = require("../config/tenantDb");
const { redisClient } = require("../config/redis");
const { sendOTPEmail } = require("../services/emailService");

const hashOTP = (otp) => crypto.createHash("sha256").update(otp).digest("hex");

const normalizeEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : "";

const normalizeLicenseCode = (code) =>
  typeof code === "string" ? code.trim().toUpperCase() : "";

const getSessionKeys = (email, licenseCode) => {
  const identity = `${email}:${licenseCode || "super_admin"}`;
  const identityHash = crypto
    .createHash("sha256")
    .update(identity)
    .digest("hex");

  return {
    otpKey: `otp:auth:${identityHash}`,
    cooldownKey: `otp:cooldown:${identityHash}`,
    pendingKey: `otp:pending:${identityHash}`,
  };
};

const validateLicense = (license) => {
  if (!license) {
    return { allowed: false, status: 404, message: "License not found." };
  }

  if (license.status !== "active") {
    return {
      allowed: false,
      status: 403,
      message: `This license is ${license.status}.`,
    };
  }

  if (
    !license.expiresAt ||
    new Date(license.expiresAt).getTime() <= Date.now()
  ) {
    return {
      allowed: false,
      status: 403,
      message: "License expired.",
    };
  }

  if (license.startDate && new Date(license.startDate).getTime() > Date.now()) {
    return {
      allowed: false,
      status: 403,
      message: "License is not active yet.",
    };
  }

  if (
    license.databaseProvisioningStatus !== "ready" ||
    !license.tenantDbName ||
    !license.tenantId
  ) {
    return {
      allowed: false,
      status: 409,
      message: "Tenant database is not ready.",
    };
  }

  return { allowed: true };
};

const findLoginUser = async ({ email, licenseCode }) => {
  const systemLicenseCode = normalizeLicenseCode(
    process.env.SUPER_ADMIN_LICENSE_CODE,
  );

  if (!systemLicenseCode) {
    return {
      error: {
        status: 500,
        message:
          "Super Admin license code is not configured. Please configure SUPER_ADMIN_LICENSE_CODE.",
      },
    };
  }

  if (licenseCode === systemLicenseCode && systemLicenseCode) {
    const user = await MasterUser.findOne({
      email,
      role: "super_admin",
      systemLicenseCode,
    });

    if (!user) {
      return { invalidCredentials: true };
    }

    return { user };
  }
  // Shop Admin login must include the license code.
  if (licenseCode) {
    const license = await License.findOne({ code: licenseCode });
    const licenseCheck = validateLicense(license);

    if (!licenseCheck.allowed) {
      return {
        error: {
          status: licenseCheck.status,
          message: licenseCheck.message,
        },
      };
    }

    const tenantContext = await getTenantConnection(license.tenantDbName);

    const user = await tenantContext.User.findOne({
      email,
      role: "shop_admin",
      licenseId: license._id,
    });

    if (!user) {
      return { invalidCredentials: true };
    }

    return {
      user,
      license,
      tenantId: String(license.tenantId),
      licenseId: String(license._id),
      tenantDbName: license.tenantDbName,
    };
  }

  // Without a license code, only Super Admin login is allowed.
  const user = await MasterUser.findOne({
    email,
    role: "super_admin",
  });

  if (!user) {
    return { invalidCredentials: true };
  }

  return { user };
};

exports.initiateLogin = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = req.body.password;

  const rawLicenseCode =
    typeof req.body.licenseCode === "string" ? req.body.licenseCode.trim() : "";

  if (rawLicenseCode && rawLicenseCode !== rawLicenseCode.toUpperCase()) {
    return res.status(400).json({
      success: false,
      message: "License code must be entered in UPPERCASE letters.",
    });
  }

  const licenseCode = normalizeLicenseCode(rawLicenseCode);

  if (!email || typeof password !== "string" || !password) {
    return res.status(400).json({
      success: false,
      message: "Provide email and password.",
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({
      success: false,
      message: "Provide a valid email address.",
    });
  }

  if (!licenseCode) {
    return res.status(400).json({
      success: false,
      message: "Please enter the Super Admin license code.",
    });
  }

  try {
    const login = await findLoginUser({ email, licenseCode });

    if (login.error) {
      return res.status(login.error.status).json({
        success: false,
        message: login.error.message,
      });
    }

    if (login.invalidCredentials) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials.",
      });
    }

    const { user, license } = login;
    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials.",
      });
    }

    const keys = getSessionKeys(email, licenseCode);

    if (await redisClient.exists(keys.cooldownKey)) {
      const remaining = await redisClient.ttl(keys.cooldownKey);

      return res.status(429).json({
        success: false,
        message: "Please wait before requesting another OTP.",
        resendIn: Math.max(remaining, 0),
      });
    }

    const rawOtp = crypto.randomInt(100000, 1000000).toString();

    // Send first. Do not create a valid OTP session if delivery fails.
    console.log(`[OTP Send on Email] OTP for ${email} is -> [ ${rawOtp} ]`);
    // await sendOTPEmail(email, rawOtp);

    const session = {
      email,
      licenseCode,
      role: user.role,
      userId: String(user._id),
      tenantId: login.tenantId || null,
      licenseId: login.licenseId || null,
      tenantDbName: login.tenantDbName || null,
    };

    await redisClient.set(keys.otpKey, hashOTP(rawOtp), {
      EX: 180,
    });

    await redisClient.set(keys.pendingKey, JSON.stringify(session), {
      EX: 600,
    });

    await redisClient.set(keys.cooldownKey, "1", {
      EX: 60,
    });

    return res.status(200).json({
      success: true,
      message: "OTP sent to your registered email address.",
      email,
      expiresIn: 180,
      resendIn: 60,
    });
  } catch (error) {
    console.error("Login initiation error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to initiate login. Check email service configuration.",
    });
  }
};

exports.verifyOTP = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp =
    typeof req.body.otp === "string"
      ? req.body.otp.trim()
      : String(req.body.otp || "");
  const licenseCode = normalizeLicenseCode(req.body.licenseCode);

  if (!email || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({
      success: false,
      message: "Provide a valid email address and 6-digit OTP.",
    });
  }

  try {
    const keys = getSessionKeys(email, licenseCode);
    const [cachedHash, pendingValue] = await Promise.all([
      redisClient.get(keys.otpKey),
      redisClient.get(keys.pendingKey),
    ]);

    if (!cachedHash || !pendingValue) {
      return res.status(400).json({
        success: false,
        message: "OTP expired or login session not found. Please log in again.",
      });
    }

    const suppliedHash = hashOTP(otp);
    const valid =
      cachedHash.length === suppliedHash.length &&
      crypto.timingSafeEqual(
        Buffer.from(cachedHash, "hex"),
        Buffer.from(suppliedHash, "hex"),
      );

    if (!valid) {
      return res.status(401).json({
        success: false,
        message: "Incorrect OTP.",
      });
    }

    const session = JSON.parse(pendingValue);
    let user;
    let license = null;

    if (session.role === "shop_admin") {
      // Re-fetch the master license and validate it again.
      license = await License.findOne({
        _id: session.licenseId,
        tenantId: session.tenantId,
        tenantDbName: session.tenantDbName,
        code: session.licenseCode,
      });

      const licenseCheck = validateLicense(license);

      if (!licenseCheck.allowed) {
        await Promise.all([
          redisClient.del(keys.otpKey),
          redisClient.del(keys.pendingKey),
        ]);

        return res.status(licenseCheck.status).json({
          success: false,
          message: licenseCheck.message,
        });
      }

      const tenantContext = await getTenantConnection(license.tenantDbName);

      user = await tenantContext.User.findOne({
        _id: session.userId,
        email,
        role: "shop_admin",
        licenseId: license._id,
      });
    } else if (session.role === "super_admin") {
      user = await MasterUser.findOne({
        _id: session.userId,
        email,
        role: "super_admin",
      });
    }

    if (!user) {
      await Promise.all([
        redisClient.del(keys.otpKey),
        redisClient.del(keys.pendingKey),
      ]);

      return res.status(401).json({
        success: false,
        message: "Account could not be verified. Please log in again.",
      });
    }

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error("JWT_SECRET is not configured.");
    }

    const claims = {
      id: String(user._id),
      role: user.role,
      email: user.email,
    };

    if (license) {
      claims.tenantId = String(license.tenantId);
      claims.licenseId = String(license._id);
      claims.tenantDbName = license.tenantDbName;
    }

    const token = jwt.sign(claims, jwtSecret, {
      expiresIn: process.env.JWT_EXPIRES_IN || "1d",
    });

    await Promise.all([
      redisClient.del(keys.otpKey),
      redisClient.del(keys.pendingKey),
      redisClient.del(keys.cooldownKey),
    ]);

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      token,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        ...(license
          ? {
              tenantId: String(license.tenantId),
              licenseId: String(license._id),
              licenseCode: license.code,
            }
          : {}),
      },
    });
  } catch (error) {
    console.error("OTP verification error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to verify OTP.",
    });
  }
};

exports.resendOTP = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const licenseCode = normalizeLicenseCode(req.body.licenseCode);

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email address is required.",
    });
  }

  try {
    const keys = getSessionKeys(email, licenseCode);
    const pendingValue = await redisClient.get(keys.pendingKey);

    if (!pendingValue) {
      return res.status(400).json({
        success: false,
        message: "Login session expired. Please log in again.",
      });
    }

    const remaining = await redisClient.ttl(keys.cooldownKey);

    if (remaining > 0) {
      return res.status(429).json({
        success: false,
        message: `Please wait ${remaining} seconds before requesting another OTP.`,
        resendIn: remaining,
      });
    }

    const session = JSON.parse(pendingValue);

    // Revalidate the license before resending a Shop Admin OTP.
    if (session.role === "shop_admin") {
      const license = await License.findOne({
        _id: session.licenseId,
        tenantId: session.tenantId,
        tenantDbName: session.tenantDbName,
        code: session.licenseCode,
      });

      const licenseCheck = validateLicense(license);

      if (!licenseCheck.allowed) {
        await Promise.all([
          redisClient.del(keys.otpKey),
          redisClient.del(keys.pendingKey),
        ]);

        return res.status(licenseCheck.status).json({
          success: false,
          message: licenseCheck.message,
        });
      }
    }

    const rawOtp = crypto.randomInt(100000, 1000000).toString();

    // Keep the existing OTP intact if email delivery fails.
    console.log(`[OTP Send on Email] OTP for ${email} is -> [ ${rawOtp} ]`);
    // await sendOTPEmail(email, rawOtp);

    await redisClient.set(keys.otpKey, hashOTP(rawOtp), {
      EX: 180,
    });

    await redisClient.set(keys.cooldownKey, "1", {
      EX: 30,
    });

    return res.status(200).json({
      success: true,
      message: "A new OTP has been sent to your email.",
      expiresIn: 180,
      resendIn: 30,
    });
  } catch (error) {
    console.error("OTP resend error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to resend OTP. Check email service configuration.",
    });
  }
};
