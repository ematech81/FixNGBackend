const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const ArtisanProfile = require('../models/ArtisanProfile');
const { sendOTP, verifyOTP, normalizePhone } = require('../services/twilioService');

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });

// Attach artisan profile to login/register response
const buildAuthResponse = async (user, statusCode, res) => {
  const token = signToken(user._id);

  let artisanProfile = null;
  if (user.role === 'artisan') {
    artisanProfile = await ArtisanProfile.findOne({ userId: user._id }).select(
      'verificationStatus onboardingComplete completedSteps skippedSteps stats badgeLevel ' +
      'isSuspended suspensionReason isBanned banReason rejectionReason'
    );
  }

  res.status(statusCode).json({
    success: true,
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      authMethod: user.authMethod,
    },
    artisanProfile,
  });
};

// ─── POST /api/auth/check-device ─────────────────────────────────────────────
// Called before showing OTP screen. If the device is already trusted for this
// phone number, skip OTP and issue a JWT directly.
// Body: { phone, deviceId }
exports.checkDevice = async (req, res) => {
  const { phone, deviceId } = req.body;

  if (!phone?.trim()) {
    return res.status(400).json({ success: false, message: 'Phone number is required.' });
  }
  if (!deviceId?.trim()) {
    return res.status(400).json({ success: false, message: 'deviceId is required.' });
  }

  try {
    const { normalizePhone } = require('../services/twilioService');
    const normalized = normalizePhone(phone.trim());

    // Block banned devices before anything else
    const bannedDeviceOwner = await User.findOne({ isActive: false, 'knownDevices.deviceId': deviceId.trim() });
    if (bannedDeviceOwner) {
      return res.status(403).json({
        success: false,
        isDeviceBanned: true,
        message: 'This device has been blocked from FixNG.',
      });
    }

    const user = await User.findOne({ phone: normalized });

    if (!user) {
      // Phone not registered — OTP needed for registration flow
      return res.status(200).json({ success: true, needsOTP: true, isNewUser: true, phone: normalized });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        isAccountDisabled: true,
        message: 'Your account has been disabled. You are no longer allowed to use FixNG.',
      });
    }

    const isKnownDevice = user.knownDevices.some((d) => d.deviceId === deviceId.trim());

    if (isKnownDevice) {
      // Known device — skip OTP, issue token directly
      return await buildAuthResponse(user, 200, res);
    }

    // Unknown device — send OTP
    const { sendOTP } = require('../services/twilioService');
    await sendOTP(normalized);

    return res.status(200).json({
      success: true,
      needsOTP: true,
      isNewUser: false,
      phone: normalized,
    });
  } catch (err) {
    console.error('checkDevice error:', err);
    const msg = err?.message?.includes('is not a valid phone number')
      ? 'Enter a valid Nigerian phone number.'
      : 'Something went wrong. Please try again.';
    return res.status(500).json({ success: false, message: msg });
  }
};

// ─── POST /api/auth/otp/send ──────────────────────────────────────────────────
// Step 1 of phone auth (both register and login).
// Body: { phone }
exports.sendOTPHandler = async (req, res) => {
  const { phone } = req.body;

  if (!phone?.trim()) {
    return res.status(400).json({ success: false, message: 'Phone number is required.' });
  }

  try {
    const { normalized } = await sendOTP(phone.trim());

    res.status(200).json({
      success: true,
      message: 'OTP sent. Please check your SMS.',
      phone: normalized,
    });
  } catch (err) {
    console.error('sendOTP error:', err);
    // Twilio errors have a specific shape
    const msg = err?.message?.includes('is not a valid phone number')
      ? 'Enter a valid Nigerian phone number.'
      : 'Failed to send OTP. Please try again.';
    res.status(500).json({ success: false, message: msg });
  }
};

// ─── POST /api/auth/otp/verify-register ──────────────────────────────────────
// Step 2 for new account creation.
// Body: { name, phone, role, otp }
exports.verifyRegister = async (req, res) => {
  const { name, phone, role, otp } = req.body;

  if (!name?.trim() || !phone?.trim() || !role || !otp?.trim()) {
    return res.status(400).json({ success: false, message: 'name, phone, role and otp are required.' });
  }

  if (!['customer', 'artisan'].includes(role)) {
    return res.status(400).json({ success: false, message: 'Role must be customer or artisan.' });
  }

  try {
    const result = await verifyOTP(phone.trim(), otp.trim());

    if (!result.valid) {
      return res.status(400).json({ success: false, message: result.reason });
    }

    // Block banned devices from creating new accounts
    const { deviceId: regDeviceId } = req.body;
    if (regDeviceId?.trim()) {
      const bannedDeviceOwner = await User.findOne({ isActive: false, 'knownDevices.deviceId': regDeviceId.trim() });
      if (bannedDeviceOwner) {
        return res.status(403).json({
          success: false,
          isDeviceBanned: true,
          message: 'This device cannot be used to create a new account on FixNG.',
        });
      }
    }

    // Check if phone is already registered
    const existing = await User.findOne({ phone: result.normalized });
    if (existing) {
      if (!existing.isActive) {
        return res.status(403).json({
          success: false,
          isAccountDisabled: true,
          message: 'This phone number is associated with a disabled account. You are no longer allowed to use FixNG.',
        });
      }
      return res.status(400).json({
        success: false,
        message: 'This phone number is already registered. Please log in instead.',
      });
    }

    const user = await User.create({
      name: name.trim(),
      phone: result.normalized,
      role,
      authMethod: 'phone',
      isPhoneVerified: true,
    });

    if (role === 'artisan') {
      try {
        await ArtisanProfile.create({ userId: user._id });
      } catch (profileErr) {
        // Profile creation failed — roll back the user so the phone isn't locked
        await User.findByIdAndDelete(user._id);
        console.error('ArtisanProfile creation failed (user rolled back):', profileErr);
        return res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
      }
    }

    await buildAuthResponse(user, 201, res);
  } catch (err) {
    console.error('verifyRegister error:', err);
    res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
  }
};

// ─── POST /api/auth/otp/verify-login ─────────────────────────────────────────
// Step 2 for existing phone-auth users logging in.
// Body: { phone, otp, deviceId? }
exports.verifyLoginOTP = async (req, res) => {
  const { phone, otp, deviceId } = req.body;

  if (!phone?.trim() || !otp?.trim()) {
    return res.status(400).json({ success: false, message: 'Phone and OTP are required.' });
  }

  try {
    const result = await verifyOTP(phone.trim(), otp.trim());

    if (!result.valid) {
      return res.status(400).json({ success: false, message: result.reason });
    }

    const user = await User.findOne({ phone: result.normalized });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found for this phone number. Please register first.',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        isAccountDisabled: true,
        message: 'Your account has been disabled. You are no longer allowed to use FixNG.',
      });
    }

    // Register this device as trusted so future logins skip OTP.
    // Use findByIdAndUpdate + $push/$slice — avoids Mongoose array-mutation tracking issues.
    if (deviceId?.trim()) {
      const alreadyKnown = user.knownDevices.some((d) => d.deviceId === deviceId.trim());
      if (!alreadyKnown) {
        await User.findByIdAndUpdate(user._id, {
          $push: {
            knownDevices: {
              $each: [{ deviceId: deviceId.trim(), addedAt: new Date() }],
              $slice: -10, // keep only the 10 most-recently-added devices
            },
          },
        });
      }
    }

    await buildAuthResponse(user, 200, res);
  } catch (err) {
    console.error('verifyLoginOTP error:', err);
    res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
};

// ─── POST /api/auth/login (email + password) ──────────────────────────────────
exports.login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Please provide email and password.' });
  }

  try {
    const user = await User.findOne({ email }).select('+password');

    if (!user || !user.password) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (!(await user.matchPassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated.' });
    }

    await buildAuthResponse(user, 200, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
};

// ─── POST /api/auth/register (email + password — kept for admin/legacy use) ───
exports.register = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { name, email, phone, password, role } = req.body;

  try {
    const existingEmail = email ? await User.findOne({ email }) : null;
    if (existingEmail) {
      return res.status(400).json({ success: false, message: 'This email is already registered.' });
    }

    const existingPhone = await User.findOne({ phone: normalizePhone(phone) });
    if (existingPhone) {
      return res.status(400).json({ success: false, message: 'This phone number is already registered.' });
    }

    const user = await User.create({
      name,
      email: email || null,
      phone: normalizePhone(phone),
      password,
      role,
      authMethod: 'email',
      isPhoneVerified: false,
    });

    if (role === 'artisan') {
      await ArtisanProfile.create({ userId: user._id });
    }

    await buildAuthResponse(user, 201, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
  }
};

// ─── POST /api/auth/become-artisan ───────────────────────────────────────────
// Called by a logged-in customer who wants to become an artisan.
// Creates an ArtisanProfile and upgrades the user's role to 'artisan'.
exports.becomeArtisan = async (req, res) => {
  try {
    const userId = req.user._id;

    // Idempotent — if they already have a profile, just return it
    let profile = await ArtisanProfile.findOne({ userId });
    if (!profile) {
      profile = await ArtisanProfile.create({ userId });
      await User.findByIdAndUpdate(userId, { role: 'artisan' });
    }

    res.status(200).json({
      success: true,
      message: 'Artisan profile created. Complete onboarding to start receiving jobs.',
      artisanProfile: {
        verificationStatus: profile.verificationStatus,
        onboardingComplete: profile.onboardingComplete,
        completedSteps: profile.completedSteps,
      },
    });
  } catch (err) {
    console.error('becomeArtisan error:', err);
    res.status(500).json({ success: false, message: 'Could not start artisan onboarding. Try again.' });
  }
};

// ─── POST /api/auth/cancel-artisan-registration ──────────────────────────────
// Called when an artisan-in-progress wants to abort and return to customer mode.
// Deletes the ArtisanProfile (including any Cloudinary uploads) and reverts role.
exports.cancelArtisanRegistration = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = req.user;

    if (user.role !== 'artisan') {
      return res.status(400).json({ success: false, message: 'Account is not in artisan registration.' });
    }

    const profile = await ArtisanProfile.findOne({ userId });
    if (profile) {
      // Clean up Cloudinary assets before deletion
      const cloudinary = require('../config/cloudinary');
      const toDelete = [];
      if (profile.profilePhoto?.publicId) toDelete.push({ id: profile.profilePhoto.publicId, type: 'image' });
      if (profile.verificationId?.publicId) toDelete.push({ id: profile.verificationId.publicId, type: 'image' });
      if (profile.skillVideo?.publicId) toDelete.push({ id: profile.skillVideo.publicId, type: 'video' });

      await Promise.allSettled(
        toDelete.map(({ id, type }) =>
          cloudinary.uploader.destroy(id, { resource_type: type }).catch(() => {})
        )
      );

      await ArtisanProfile.findByIdAndDelete(profile._id);
    }

    // Revert role to customer
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { role: 'customer' },
      { new: true }
    );

    const token = require('jsonwebtoken').sign({ id: updatedUser._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '30d',
    });

    res.status(200).json({
      success: true,
      message: 'Artisan registration cancelled. You are now a customer.',
      token,
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        role: updatedUser.role,
        authMethod: updatedUser.authMethod,
      },
    });
  } catch (err) {
    console.error('cancelArtisanRegistration error:', err);
    res.status(500).json({ success: false, message: 'Could not cancel registration. Please try again.' });
  }
};

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
exports.getMe = async (req, res) => {
  try {
    const user = req.user;
    let artisanProfile = null;

    if (user.role === 'artisan') {
      artisanProfile = await ArtisanProfile.findOne({ userId: user._id }).select(
        'verificationStatus onboardingComplete completedSteps skippedSteps stats badgeLevel isPro proSource'
      );
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        authMethod: user.authMethod,
      },
      artisanProfile,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};
