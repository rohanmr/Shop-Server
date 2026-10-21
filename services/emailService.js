
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const sendOTPEmail = async (email, otp) => {
  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: email, // Must be your Resend account email for testing
    subject: "Your Login Verification Code",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Login Verification</h2>
        <p>Your one-time password is:</p>
        <h1 style="letter-spacing: 8px;">${otp}</h1>
        <p>This code expires in 3 minutes.</p>
        <p>If you did not request this code, ignore this email.</p>
      </div>
    `,
    text: `Your login OTP is ${otp}. It expires in 3 minutes.`,
  });

  if (error) {
    console.error("Email sending failed:", error.message);
    throw new Error("Unable to send OTP email.");
  }

  return data;
};

module.exports = { sendOTPEmail };
