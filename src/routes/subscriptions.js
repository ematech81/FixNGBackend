const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/subscriptionController');

// Public
router.get('/plans', ctrl.getPlans);

// Flutterwave webhook — no auth, verified via verif-hash header
router.post('/webhook', ctrl.flutterwaveWebhook);

// Authenticated
router.get('/me',        protect, ctrl.getMySubscription);
router.post('/initiate', protect, ctrl.initiateSubscription);
router.post('/verify',   protect, ctrl.verifySubscription);
router.post('/cancel',   protect, ctrl.cancelSubscription);

module.exports = router;
