
const express = require("express");
const multer = require("multer");

const { authToken, authRoles } = require("../middleware/auth");

const {
  uploadLicenseDocument,
  getLicenseDocuments,
  downloadLicenseDocument,
} = require("../controllers/licenseDocumentController");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },
});

router.use(authToken, authRoles("super_admin"));

router.post(
  "/:licenseId/documents",
  upload.single("document"),
  uploadLicenseDocument,
);

router.get(
  "/:licenseId/documents",
  getLicenseDocuments,
);

router.get(
  "/:licenseId/documents/:documentId",
  downloadLicenseDocument,
);

module.exports = router;
