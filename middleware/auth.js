const jwt = require("jsonwebtoken");
const { getLicenseAccessStatus } = require("../services/licenseService");

const authToken = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please log in.",
      });
    }

    const token = authorization.split(" ")[1];

    let decoded;

    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: "Your session is invalid or expired. Please log in again.",
      });
    }

    req.user = decoded;

    // Validate the current database license on every protected request.
    if (decoded.role === "shop_admin") {
      const licenseAccess = await getLicenseAccessStatus(
        decoded.id || decoded._id,
      );

      if (!licenseAccess.allowed) {
        return res.status(licenseAccess.statusCode).json({
          success: false,
          message: licenseAccess.message,
          code: licenseAccess.message.startsWith("License expired.")
            ? "LICENSE_EXPIRED"
            : undefined,
        });
      }
    }

    return next();
  } catch (error) {
    console.error("Authentication middleware error:", error);

    return res.status(500).json({
      success: false,
      message: "Authentication could not be completed.",
    });
  }
};

const authRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to access this resource.",
      });
    }

    next();
  };
};

module.exports = {
  authToken,
  authRoles,
};
