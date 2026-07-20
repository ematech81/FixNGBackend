const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/notificationController');

router.use(protect);

router.get('/',              ctrl.getNotifications);
router.get('/unread-count',  ctrl.getUnreadCount);
router.get('/banners',       ctrl.getBanners);
router.patch('/read-all',           ctrl.markAllRead);
router.patch('/read-by-job/:jobId', ctrl.markJobMessagesRead);
router.patch('/:id/read',           ctrl.markRead);
router.patch('/:id/dismiss', ctrl.dismissBanner);
router.delete('/clear-all',  ctrl.clearAll);
router.delete('/:id',        ctrl.deleteNotification);

module.exports = router;
