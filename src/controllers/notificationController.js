const Notification = require('../models/Notification');
const User         = require('../models/User');
const { emitToUser } = require('../socket');
const { sendPush }   = require('../services/pushService');

// Types that show as a persistent home-screen banner until dismissed
const PINNED_TYPES = new Set([
  'profile_verified',
  'badge_upgraded',
  'new_job',
  'job_broadcast',
  'announcement',
]);

// ─── Helper: create + emit + push a notification ──────────────────────────────
const notify = async (userId, type, title, body, data = {}) => {
  try {
    const pinned = PINNED_TYPES.has(type);
    const notif  = await Notification.create({ userId, type, title, body, data, pinned });

    emitToUser(userId.toString(), 'notification', {
      id:        notif._id,
      type:      notif.type,
      title:     notif.title,
      body:      notif.body,
      data:      notif.data,
      read:      false,
      pinned:    notif.pinned,
      createdAt: notif.createdAt,
    });

    User.findById(userId).select('expoPushToken').lean().then((user) => {
      if (user?.expoPushToken) {
        sendPush(user.expoPushToken, title, body, { type, ...data });
      }
    }).catch(() => {});

    return notif;
  } catch (err) {
    console.error('notify() failed:', err.message);
    return null;
  }
};

exports.notify = notify;

// ─── GET /api/notifications — Paginated list for the current user ─────────────
exports.getNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 30, unreadOnly } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = { userId: req.user._id };
    if (unreadOnly === 'true') query.read = false;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Notification.countDocuments(query),
      Notification.countDocuments({ userId: req.user._id, read: false }),
    ]);

    res.status(200).json({
      success: true,
      data: notifications,
      unreadCount,
      pagination: { page: parseInt(page), limit: parseInt(limit), total },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch notifications.' });
  }
};

// ─── GET /api/notifications/banners — Active home-screen banners ──────────────
exports.getBanners = async (req, res) => {
  try {
    const banners = await Notification.find({
      userId:    req.user._id,
      pinned:    true,
      dismissed: false,
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.status(200).json({ success: true, data: banners });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch banners.' });
  }
};

// ─── PATCH /api/notifications/:id/dismiss — Dismiss a banner permanently ──────
exports.dismissBanner = async (req, res) => {
  try {
    await Notification.updateOne(
      { _id: req.params.id, userId: req.user._id },
      { dismissed: true, read: true }
    );
    res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to dismiss banner.' });
  }
};

// ─── GET /api/notifications/unread-count ─────────────────────────────────────
exports.getUnreadCount = async (req, res) => {
  try {
    const filter = { userId: req.user._id, read: false };
    if (req.query.type) filter.type = req.query.type;
    const count = await Notification.countDocuments(filter);
    res.status(200).json({ success: true, count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to get unread count.' });
  }
};

// ─── PATCH /api/notifications/read-by-job/:jobId — Mark new_message notifications for one job as read ─
exports.markJobMessagesRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.user._id, read: false, type: 'new_message', 'data.jobId': req.params.jobId },
      { read: true }
    );
    res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to mark messages as read.' });
  }
};

// ─── PATCH /api/notifications/:id/read — Mark one as read ────────────────────
exports.markRead = async (req, res) => {
  try {
    await Notification.updateOne(
      { _id: req.params.id, userId: req.user._id },
      { read: true }
    );
    res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to mark as read.' });
  }
};

// ─── PATCH /api/notifications/read-all — Mark all (or filtered subset) as read ─
exports.markAllRead = async (req, res) => {
  try {
    const filter = { userId: req.user._id, read: false };
    if (req.body?.type)  filter.type = req.body.type;
    if (req.body?.jobId) filter['data.jobId'] = req.body.jobId;
    await Notification.updateMany(filter, { read: true });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to mark all as read.' });
  }
};

// ─── DELETE /api/notifications/:id ───────────────────────────────────────────
exports.deleteNotification = async (req, res) => {
  try {
    await Notification.deleteOne({ _id: req.params.id, userId: req.user._id });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to delete notification.' });
  }
};

// ─── DELETE /api/notifications — Clear all ───────────────────────────────────
exports.clearAll = async (req, res) => {
  try {
    await Notification.deleteMany({ userId: req.user._id });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to clear notifications.' });
  }
};
