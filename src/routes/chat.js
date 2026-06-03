const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const { uploadChatImage, uploadChatAudio, handleUploadError } = require('../middleware/upload');
const { getChatHistory, sendMessage, sendImageMessage, sendAudioMessage, getConversations } = require('../controllers/chatController');

// 60 messages per user per minute
const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many messages. Please slow down.' },
});

// All chat routes require authentication (customer or artisan)
router.use(protect, restrictTo('customer', 'artisan'));

// Must be defined before /:jobId so Express doesn't treat 'conversations' as a jobId
router.get('/conversations', getConversations);

router.get('/:jobId', getChatHistory);
router.post('/:jobId', messageLimiter, sendMessage);
router.post('/:jobId/image', messageLimiter, uploadChatImage, handleUploadError, sendImageMessage);
router.post('/:jobId/audio', messageLimiter, uploadChatAudio, handleUploadError, sendAudioMessage);

module.exports = router;
