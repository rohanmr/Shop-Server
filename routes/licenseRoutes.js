// backend/routes/licenseRoutes.js
const express = require("express");
const router = express.Router();
const {
  createLicense,
  getAllLicenses,
  getAvailableLicenses,
  renewLicense,
  updateLicense,
  deleteLicense,
  retryProvisioning,
} = require("../controllers/licenseController");
const { authToken, authRoles } = require("../middleware/auth");

router.get("/get-all", authToken, authRoles("super_admin"), getAllLicenses);
router.post("/create", authToken, authRoles("super_admin"), createLicense);
router.get(
  "/available",
  authToken,
  authRoles("super_admin"),
  getAvailableLicenses,
);
router.post("/:id/renew", authToken, authRoles("super_admin"), renewLicense);
router.put("/update/:id", authToken, authRoles("super_admin"), updateLicense);
router.delete("/delete/:id", authToken, authRoles("super_admin"), deleteLicense);

module.exports = router;
