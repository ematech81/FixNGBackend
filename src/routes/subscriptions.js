const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/subscriptionController');

// Public
router.get('/plans', ctrl.getPlans);

// Paystack webhook — no auth, uses signature verification instead
router.post('/webhook', express.raw({ type: 'application/json' }), ctrl.paystackWebhook);

// Authenticated
router.get('/me',         protect, ctrl.getMySubscription);
router.post('/initiate',  protect, ctrl.initiateSubscription);
router.post('/verify',    protect, ctrl.verifySubscription);
router.post('/cancel',    protect, ctrl.cancelSubscription);

module.exports = router;
