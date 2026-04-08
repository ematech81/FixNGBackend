const mongoose = require('mongoose');

const OTPSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
  },
  // Hashed OTP stored — never raw
  otpHash: {
    type: String,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  // How many times user has attempted wrong code (max 5)
  attempts: {
    type: Number,
    default: 0,
  },
  verified: {
    type: Boolean,
    default: false,
  },
});

// Auto-delete expired OTPs from DB
OTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// One OTP record per phone at a time
OTPSchema.index({ phone: 1 });

module.exports = mongoose.model('OTP', OTPSchema);
