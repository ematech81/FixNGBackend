const Notification = require('../models/Notification');
const User         = require('../models/User');
const { emitToUser } = require('../socket');
const { sendPush }   = require('../services/pushService');
const webPush        = require('../services/webPushService');
const PushSubscription = require('../models/PushSubscription');
const { emailUser }  = require('../utils/emailNotifications');

// Types that show as a persistent home-screen banner until dismissed
const PINNED_TYPES = new Set([
  'profile_verified',
  'badge_upgraded',
  'new_job',
  'job_broadcast',
  'announcement',
]);

// Notification types that also trigger an email. These can be frequent, so they are
// low-priority: throttled per user and held under a daily cap (see emailNotifications).
const EMAIL_ON_NOTIFY = {
  new_message:   { template: 'new_message',   throttleMs: 30 * 60 * 1000 },
  job_broadcast: { template: 'job_broadcast', throttleMs: 15 * 60 * 1000 },
};

// Where a tapped web-push notification should open
const webPushUrl = (role, type, data) => {
  if (role === 'admin') return '/admin/dashboard';
  const base = role === 'artisan' ? '/artisan' : '/customer';
  if (type === 'new_message') return data?.jobId ? `${base}/messages/${data.jobId}` : `${base}/messages`;
  return `${base}/notifications`;
};

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

    User.findById(userId).select('expoPushToken role').lean().then((user) => {
      if (user?.expoPushToken) {
        sendPush(user.expoPushToken, title, body, { type, ...data });
      }
      // Browser push for website users (no-op until they opt in / VAPID keys are set)
      webPush.sendWebPush(userId, {
        title,
        body,
        type,
        url: webPushUrl(user?.role, type, data),
        tag: data?.jobId ? `${type}-${data.jobId}` : type,
      });
    }).catch(() => {});

    const emailRule = EMAIL_ON_NOTIFY[type];
    if (emailRule) {
      emailUser(userId, emailRule.template, { title, body, ...data }, { throttleMs: emailRule.throttleMs, lowPriority: true });
    }

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

// ─── GET /api/notifications/web-push/key — VAPID public key for the browser ───
exports.getWebPushKey = (req, res) => {
  res.status(200).json({ success: true, enabled: webPush.isEnabled(), publicKey: webPush.getPublicKey() });
};

// ─── POST /api/notifications/web-push/subscribe — Save this browser's subscription
// Body: { subscription: { endpoint, keys: { p256dh, auth } } }
exports.subscribeWebPush = async (req, res) => {
  try {
    const sub = req.body?.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return res.status(400).json({ success: false, message: 'Invalid push subscription.' });
    }
    // Upsert by endpoint: a browser belongs to whoever subscribed last
    await PushSubscription.findOneAndUpdate(
      { endpoint: sub.endpoint },
      {
        userId: req.user._id,
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
        userAgent: (req.headers['user-agent'] || '').slice(0, 250),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('subscribeWebPush error:', err);
    res.status(500).json({ success: false, message: 'Could not save push subscription.' });
  }
};

// ─── POST /api/notifications/web-push/unsubscribe — Remove this browser (e.g. on logout)
// Body: { endpoint }
exports.unsubscribeWebPush = async (req, res) => {
  try {
    const endpoint = req.body?.endpoint;
    if (!endpoint) return res.status(400).json({ success: false, message: 'endpoint is required.' });
    await PushSubscription.deleteOne({ endpoint, userId: req.user._id });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('unsubscribeWebPush error:', err);
    res.status(500).json({ success: false, message: 'Could not remove push subscription.' });
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
