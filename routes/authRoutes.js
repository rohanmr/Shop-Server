
const express = require("express");
const router = express.Router();

const {
  initiateLogin,
  verifyOTP,
  resendOTP
} = require("../controllers/authController");

const { loginLimiter } = require("../middleware/rateLimiter");

router.post("/login/initiate", loginLimiter, initiateLogin);
router.post("/login/verify", loginLimiter, verifyOTP);
router.post("/login/resend-otp", loginLimiter, resendOTP);

module.exports = router;
