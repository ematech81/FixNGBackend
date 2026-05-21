const express = require('express');
const router  = express.Router();
const { korapayWebhook } = require('../controllers/webhookController');

// NOTE: express.raw() is applied in app.js BEFORE the global JSON parser,
// so req.body here is a raw Buffer — required for HMAC signature verification.
router.post('/korapay', korapayWebhook);

module.exports = router;
