const Notification = require('../models/Notification');
const User         = require('../models/User');
const { emitToUser } = require('../socket');
const { sendPush }   = require('../services/pushService');

// ─── Helper: create + emit + push a notification ──────────────────────────────
// Single call from any controller:
//   1. Saves to DB (notification history)
//   2. Emits via socket (in-app real-time, if user is connected)
//   3. Sends Expo push (device notification, if user has a token and is not connected)
const notify = async (userId, type, title, body, data = {}) => {
  try {
    const notif = await Notification.create({ userId, type, title, body, data });

    // Real-time in-app delivery
    emitToUser(userId.toString(), 'notification', {
      id:        notif._id,
      type:      notif.type,
      title:     notif.title,
      body:      notif.body,
      data:      notif.data,
      read:      false,
      createdAt: notif.createdAt,
    });

    // Push notification (background / device-level)
    // Fetch token without blocking — fire and forget
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

// ─── GET /api/notifications/unread-count ─────────────────────────────────────
exports.getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      userId: req.user._id,
      read: false,
    });
    res.status(200).json({ success: true, count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to get unread count.' });
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

// ─── PATCH /api/notifications/read-all — Mark all as read ────────────────────
exports.markAllRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.user._id, read: false },
      { read: true }
    );
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
