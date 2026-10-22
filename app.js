const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const connectDB = require("./config/db");
const { connectRedis } = require("./config/redis");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
  }),
);
require("dotenv").config();
app.use(
  cors({
    origin: (process.env.FRONTEND_URL || "http://localhost:5173")
      .trim()
      .replace(/\/+$/, ""),
    credentials: true,
  }),
);

app.use(express.json());

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "SaaS authentication API is running",
  });
});

async function startServer() {
  try {
    await connectDB();
    await connectRedis();

    // Import routes only after Redis connects
    const authRoute = require("./routes/authRoutes");
    const userRoute = require("./routes/userRoutes");
    const licenseRoute = require("./routes/licenseRoutes");
    const licenseDocumentRoutes = require("./routes/licenseDocumentRoutes");

    app.use("/api/auth", authRoute);
    app.use("/api/users", userRoute);
    app.use("/api/licenses", licenseRoute);
    app.use("/api/license-documents", licenseDocumentRoutes);
    app.use("/uploads", express.static(path.join(__dirname, "uploads")));

    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
