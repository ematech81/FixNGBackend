const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    // Email is optional — only used for email/password login.
    // No unique index here; uniqueness is enforced at application level in the register
    // controller so we avoid Mongoose sparse-index issues with null values.
    email: {
      type: String,
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
    // Expo push token — updated each time the app registers on a device
    expoPushToken: {
      type: String,
      default: null,
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

    // ── Customer moderation fields ────────────────────────────────────────────
    warningCount:     { type: Number, default: 0 },
    isSuspended:      { type: Boolean, default: false },
    suspensionReason: { type: String, default: null },
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
