const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verify JWT and attach user to request
exports.protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized. No token.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');

    if (!req.user) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }

    if (!req.user.isActive) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated.' });
    }

    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token invalid or expired.' });
  }
};

// Restrict access by role
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(' or ')}.`,
      });
    }
    next();
  };
};

// Block artisan from receiving jobs if not verified
exports.requireVerified = async (req, res, next) => {
  try {
    const ArtisanProfile = require('../models/ArtisanProfile');
    const profile = await ArtisanProfile.findOne({ userId: req.user._id });

    if (!profile || profile.verificationStatus !== 'verified') {
      return res.status(403).json({
        success: false,
        message: 'Your account must be verified before you can receive or accept jobs.',
        verificationStatus: profile ? profile.verificationStatus : 'incomplete',
        onboardingComplete: profile ? profile.onboardingComplete : false,
      });
    }

    req.artisanProfile = profile;
    next();
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};
