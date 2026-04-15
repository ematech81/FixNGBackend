const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/notificationController');

router.use(protect); // all routes require login

router.get('/',              ctrl.getNotifications);
router.get('/unread-count',  ctrl.getUnreadCount);
router.patch('/read-all',    ctrl.markAllRead);
router.patch('/:id/read',    ctrl.markRead);
router.delete('/clear-all',  ctrl.clearAll);
router.delete('/:id',        ctrl.deleteNotification);

module.exports = router;
