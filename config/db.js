const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: process.env.MONGO_DB_NAME || "test",
    });

    console.log(
      `Master Database Connected: ${mongoose.connection.name}`,
    );
  } catch (err) {
    console.error("Master Database connection failed:", err.message);
    process.exit(1);
  }
};

module.exports = connectDB;