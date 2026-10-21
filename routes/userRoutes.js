// backend/routes/userRoutes.js
const express = require("express");
const router = express.Router();
const {
  createShopAdmin,
  createSuperAdmin,
  getAllShopAdmins,
  getShopAdminById,
  updateShopAdmin,
  deleteShopAdmin,
} = require("../controllers/userController");

const { uploadProfileImage } = require("../middleware/profileUpload");

const {
  getMyProfile,
  updateMyProfile,
} = require("../controllers/profileController");

const { authToken, authRoles } = require("../middleware/auth");

router.post(
  "/register-super-admin",
  authToken,
  authRoles("super_admin"),
  createSuperAdmin,
);

router.post(
  "/register-shop-admin",
  authToken,
  authRoles("super_admin"),
  createShopAdmin,
);

//Shop Admin Routes

router.get(
  "/shop-admins",
  authToken,
  authRoles("super_admin"),
  getAllShopAdmins,
);

router.get(
  "/shop-admin/:id",
  authToken,
  authRoles("super_admin"),
  getShopAdminById,
);

router.patch(
  "/shop-admin/:id",
  authToken,
  authRoles("super_admin"),
  updateShopAdmin,
);

router.delete(
  "/shop-admin/:id",
  authToken,
  authRoles("super_admin"),
  deleteShopAdmin,
);

// Both roles can access only their own profile.
router.get("/profile", authToken, getMyProfile);
// router.patch("/profile", authToken, updateMyProfile);
router.patch(
  "/profile",
  authToken,
  (req, res, next) => {
    // Use Multer only when the request contains multipart form data.
    if (req.is("multipart/form-data")) {
      return uploadProfileImage.single("profileImage")(req, res, (error) => {
        if (error) {
          const message =
            error.code === "LIMIT_FILE_SIZE"
              ? "Image size must not exceed 2 MB."
              : error.message || "Invalid image upload.";

          return res.status(400).json({
            success: false,
            message,
          });
        }

        next();
      });
    }

    next();
  },
  updateMyProfile,
);
module.exports = router;
