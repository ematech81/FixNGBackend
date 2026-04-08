const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const { uploadChatImage, handleUploadError } = require('../middleware/upload');
const { getChatHistory, sendMessage, sendImageMessage } = require('../controllers/chatController');

// All chat routes require authentication (customer or artisan)
router.use(protect, restrictTo('customer', 'artisan'));

router.get('/:jobId', getChatHistory);
router.post('/:jobId', sendMessage);
router.post('/:jobId/image', uploadChatImage, handleUploadError, sendImageMessage);

module.exports = router;
