const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const { uploadChatImage, uploadChatAudio, handleUploadError } = require('../middleware/upload');
const { getChatHistory, sendMessage, sendImageMessage, sendAudioMessage, getConversations } = require('../controllers/chatController');

// All chat routes require authentication (customer or artisan)
router.use(protect, restrictTo('customer', 'artisan'));

// Must be defined before /:jobId so Express doesn't treat 'conversations' as a jobId
router.get('/conversations', getConversations);

router.get('/:jobId', getChatHistory);
router.post('/:jobId', sendMessage);
router.post('/:jobId/image', uploadChatImage, handleUploadError, sendImageMessage);
router.post('/:jobId/audio', uploadChatAudio, handleUploadError, sendAudioMessage);

module.exports = router;
