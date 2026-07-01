const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const ArtisanProfile = require('../models/ArtisanProfile');
const { sendOTP, verifyOTP, normalizePhone } = require('../services/smsService');
const { generateArtisanCode } = require('../utils/generateArtisanCode');

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
    const { normalizePhone } = require('../services/smsService');
    const normalized = normalizePhone(phone.trim());

    const user = await User.findOne({ phone: normalized });

    // Admin accounts always bypass device bans — they must be able to log in
    // from any device regardless of whether that device was previously flagged.
    const isAdmin = user?.role === 'admin';

    if (!isAdmin) {
      // Block banned devices for non-admin users
      const bannedDeviceOwner = await User.findOne({ isActive: false, 'knownDevices.deviceId': deviceId.trim() });
      if (bannedDeviceOwner) {
        return res.status(403).json({
          success: false,
          isDeviceBanned: true,
          message: 'This device has been blocked from FixNG.',
        });
      }
    }

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

    // Unknown device — send OTP (with email fallback using stored user email)
    const { sendOTP: _sendOTP } = require('../services/smsService');
    const otpResult = await _sendOTP(normalized, user?.email || null);

    return res.status(200).json({
      success:  true,
      needsOTP: true,
      isNewUser: false,
      phone:    normalized,
      hasEmail:  !!user?.email,
      emailUsed: otpResult.emailUsed,
      ...(otpResult.maskedEmail ? { maskedEmail: otpResult.maskedEmail } : {}),
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
// Body: { phone, email?, forceEmail? }
exports.sendOTPHandler = async (req, res) => {
  const { phone, email: rawEmail, forceEmail } = req.body;

  if (!phone?.trim()) {
    return res.status(400).json({ success: false, message: 'Phone number is required.' });
  }

  try {
    const normalized = phone.trim();

    // Resolve email: use request body value, or — when forceEmail and no email provided
    // — look up the existing user's stored email (login flow with no email field on screen)
    let resolvedEmail = rawEmail?.trim()?.toLowerCase() || null;
    if (!resolvedEmail && forceEmail) {
      const { normalizePhone } = require('../services/smsService');
      const existing = await User.findOne({ phone: normalizePhone(normalized) }).select('email').lean();
      resolvedEmail = existing?.email || null;
    }

    const result = await sendOTP(normalized, resolvedEmail, !!forceEmail);

    res.status(200).json({
      success: true,
      message: result.emailUsed
        ? 'Your access key has been sent to your email.'
        : 'Your access key has been sent. It may take up to 2 minutes to arrive.',
      phone: result.normalized,
      emailUsed: result.emailUsed,
      ...(result.maskedEmail ? { maskedEmail: result.maskedEmail } : {}),
    });
  } catch (err) {
    console.error('sendOTP error:', err);
    const msg = err?.message?.includes('is not a valid phone number')
      ? 'Enter a valid Nigerian phone number.'
      : err?.message || 'Failed to send OTP. Please try again.';
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

    // Validate and resolve email
    const { email: rawEmail } = req.body;
    const email = rawEmail?.trim()?.toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address format.' });
    }
    if (email) {
      const emailTaken = await User.findOne({ email }).lean();
      if (emailTaken) {
        return res.status(400).json({ success: false, message: 'This email is already registered to another account.' });
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
      name:            name.trim(),
      phone:           result.normalized,
      email:           email || null,
      role,
      authMethod:      'phone',
      isPhoneVerified: true,
    });

    if (role === 'artisan') {
      try {
        await ArtisanProfile.create({ userId: user._id });
        // Assign a unique human-readable ID (non-fatal — artisan can still use the app without it)
        try {
          const code = await generateArtisanCode(User);
          await User.findByIdAndUpdate(user._id, { artisanCode: code });
          user.artisanCode = code;
        } catch (codeErr) {
          console.warn('[artisanCode] non-fatal on register:', codeErr.message);
        }
        // Start 7-day free trial for every new artisan (non-fatal if it fails)
        require('../helpers/subscriptionHelper').startTrial(user._id).catch(
          (e) => console.warn('[startTrial] non-fatal on register:', e.message)
        );
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

    // Upsert instead of create — bypasses Mongoose validators so schema
    // changes (e.g. new enum fields) never break onboarding for new artisans.
    const isNew = !(await ArtisanProfile.exists({ userId }));
    const profile = await ArtisanProfile.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId } },
      { upsert: true, new: true }
    );
    if (isNew) {
      const codeUpdates = { role: 'artisan' };
      // Assign artisan code if the user doesn't have one yet
      try {
        const code = await generateArtisanCode(User);
        codeUpdates.artisanCode = code;
      } catch (codeErr) {
        console.warn('[artisanCode] non-fatal on becomeArtisan:', codeErr.message);
      }
      await User.findByIdAndUpdate(userId, codeUpdates);
      // Start 7-day free trial (non-fatal if it fails)
      require('../helpers/subscriptionHelper').startTrial(userId).catch(
        (e) => console.warn('[startTrial] non-fatal on becomeArtisan:', e.message)
      );
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

// ─── PUT /api/auth/profile ────────────────────────────────────────────────────
exports.updateUserProfile = async (req, res) => {
  try {
    const { name, email } = req.body;

    const updates = {};
    if (name?.trim()) updates.name = name.trim();
    if (email !== undefined) {
      updates.email = email?.trim()?.toLowerCase() || null;
    }

    if (updates.email) {
      const existing = await User.findOne({ email: updates.email, _id: { $ne: req.user._id } });
      if (existing) {
        return res.status(400).json({ success: false, message: 'This email is already in use by another account.' });
      }
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true });

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        authMethod: user.authMethod,
      },
    });
  } catch (err) {
    console.error('updateUserProfile error:', err);
    res.status(500).json({ success: false, message: 'Failed to update profile.' });
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
        artisanCode: user.artisanCode || null,
      },
      artisanProfile,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};
