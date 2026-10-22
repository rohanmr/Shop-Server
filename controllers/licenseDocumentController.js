const mongoose = require("mongoose");
const { Readable } = require("stream");

const License = require("../models/License");
const { getTenantConnection } = require("../config/tenantDb");

const BUCKET_NAME = "licenseDocuments";

const getReadyLicense = async (licenseId) => {
  if (!mongoose.isValidObjectId(licenseId)) {
    const error = new Error("Invalid license ID.");
    error.statusCode = 400;
    throw error;
  }

  const license = await License.findById(licenseId).lean();

  if (!license) {
    const error = new Error("License not found.");
    error.statusCode = 404;
    throw error;
  }

  if (license.databaseProvisioningStatus !== "ready") {
    const error = new Error("Tenant database is not ready.");
    error.statusCode = 409;
    throw error;
  }

  if (license.documentStorageType !== "mongodb_gridfs") {
    const error = new Error(
      "This license requires an object-storage provider that is not configured.",
    );
    error.statusCode = 501;
    throw error;
  }

  return license;
};

const ensureLicenseDocumentAccess = (license) => {
  if (license.status !== "active") {
    const error = new Error("This license is not currently active.");
    error.statusCode = 403;
    throw error;
  }

  if (!license.expiresAt || new Date(license.expiresAt) <= new Date()) {
    const error = new Error("License has expired.");
    error.statusCode = 403;
    throw error;
  }
};

const getBucket = async (license) => {
  const tenant = await getTenantConnection(license.tenantDbName);

  return {
    license,
    connection: tenant.connection,
    bucket: new mongoose.mongo.GridFSBucket(tenant.connection.db, {
      bucketName: BUCKET_NAME,
    }),
  };
};

const uploadLicenseDocument = async (req, res) => {
  try {
    const { licenseId } = req.params;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please select a document to upload.",
      });
    }

    const { license, connection, bucket } = await getBucket(
      await getReadyLicense(licenseId),
    );

    if (
      license.status !== "active" ||
      new Date(license.expiresAt) <= new Date()
    ) {
      return res.status(403).json({
        success: false,
        message: "This license is not currently active.",
      });
    }

    // Enforce the license's total storage quota.
    const filesCollection = connection.db.collection(`${BUCKET_NAME}.files`);

    const usage = await filesCollection
      .aggregate([
        {
          $match: {
            "metadata.tenantId": license.tenantId,
            "metadata.licenseId": license._id,
          },
        },
        {
          $group: {
            _id: null,
            totalBytes: { $sum: "$length" },
          },
        },
      ])
      .toArray();

    const usedBytes = usage[0]?.totalBytes || 0;
    const maxBytes = license.storageLimitGB * 1024 ** 3;

    if (usedBytes + req.file.size > maxBytes) {
      return res.status(413).json({
        success: false,
        message: "Tenant storage limit exceeded.",
      });
    }

    const originalName = req.file.originalname
      .replace(/[/\\]/g, "_")
      .slice(0, 200);

    const uploadStream = bucket.openUploadStream(
      `${Date.now()}-${originalName}`,
      {
        contentType: req.file.mimetype,
        metadata: {
          tenantId: license.tenantId,
          licenseId: license._id,
          originalName,
          contentType: req.file.mimetype,
          uploadedBy: req.user.id,
          uploadedAt: new Date(),
        },
      },
    );

    await new Promise((resolve, reject) => {
      uploadStream.once("finish", resolve);
      uploadStream.once("error", reject);
      Readable.from(req.file.buffer).pipe(uploadStream);
    });

    return res.status(201).json({
      success: true,
      message: "Document uploaded successfully.",
      document: {
        id: uploadStream.id,
        tenantId: license.tenantId,
        licenseId: license._id,
        filename: originalName,
        contentType: req.file.mimetype,
        size: req.file.size,
      },
    });
  } catch (error) {
    console.error("Upload license document error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Failed to upload document.",
    });
  }
};

const getLicenseDocuments = async (req, res) => {
  try {
    const license = await getReadyLicense(req.params.licenseId);
    ensureLicenseDocumentAccess(license);
    const { bucket } = await getBucket(license);

    const files = await bucket
      .find({
        "metadata.tenantId": license.tenantId,
        "metadata.licenseId": license._id,
      })
      .toArray();

    return res.status(200).json({
      success: true,
      count: files.length,
      documents: files.map((file) => ({
        id: file._id,
        filename: file.metadata?.originalName || file.filename,
        contentType: file.metadata?.contentType || file.contentType,
        size: file.length,
        uploadedAt: file.uploadDate,
        tenantId: license.tenantId,
        licenseId: license._id,
      })),
    });
  } catch (error) {
    console.error("Get license documents error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Failed to retrieve license documents.",
    });
  }
};

const downloadLicenseDocument = async (req, res) => {
  try {
    const license = await getReadyLicense(req.params.licenseId);
    ensureLicenseDocumentAccess(license);

    if (!mongoose.isValidObjectId(req.params.documentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid document ID.",
      });
    }

    const { bucket } = await getBucket(license);

    // Always match both IDs, not only the document ID.
    const files = await bucket
      .find({
        _id: new mongoose.Types.ObjectId(req.params.documentId),
        "metadata.tenantId": license.tenantId,
        "metadata.licenseId": license._id,
      })
      .toArray();

    const file = files[0];

    if (!file) {
      return res.status(404).json({
        success: false,
        message: "Document not found for this license.",
      });
    }

    const contentType =
      file.metadata?.contentType || "application/octet-stream";

    const filename = (file.metadata?.originalName || file.filename).replace(
      /["\r\n]/g,
      "_",
    );

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const stream = bucket.openDownloadStream(file._id);

    stream.on("error", (error) => {
      console.error("Document download stream error:", error);

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: "Failed to download document.",
        });
      } else {
        res.destroy(error);
      }
    });

    stream.pipe(res);
  } catch (error) {
    console.error("Download license document error:", error);

    if (!res.headersSent) {
      res.status(error.statusCode || 500).json({
        success: false,
        message: error.statusCode
          ? error.message
          : "Failed to download document.",
      });
    }
  }
};

module.exports = {
  uploadLicenseDocument,
  getLicenseDocuments,
  downloadLicenseDocument,
};
