const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    // Email is optional — only used for email/password login
    email: {
      type: String,
      unique: true,
      sparse: true,   // sparse index allows multiple docs with null email
      lowercase: true,
      trim: true,
      default: null,
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      unique: true,
      trim: true,
    },
    // Password is optional — phone-OTP users don't have one
    password: {
      type: String,
      minlength: 6,
      select: false,
      default: null,
    },
    role: {
      type: String,
      enum: ['customer', 'artisan', 'admin'],
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Set to true once OTP-verified. Email users are verified on registration.
    isPhoneVerified: {
      type: Boolean,
      default: false,
    },
    // Which auth method this account uses
    authMethod: {
      type: String,
      enum: ['phone', 'email'],
      default: 'phone',
    },
    // Trusted device IDs — OTP is skipped for known devices
    knownDevices: {
      type: [
        {
          deviceId: { type: String, required: true },
          addedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

// Hash password before saving (skip if phone-only user has no password)
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);
