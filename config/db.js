const mongoose = require("mongoose");
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Database Connected");
  } catch (err) {
    console.error("Database link failure:", err.message);
    process.exit(1);
  }
};
module.exports = connectDB;
