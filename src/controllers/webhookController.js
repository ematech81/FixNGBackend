'use strict';

const crypto      = require('crypto');
const Transaction = require('../models/Transaction');
const Refund      = require('../models/Refund');
const helper      = require('../helpers/subscriptionHelper');

// ─── POST /api/webhooks/korapay ───────────────────────────────────────────────
// IMPORTANT: this handler receives a Buffer (express.raw), not a parsed object.
// The raw body is required for HMAC-SHA256 signature verification.
exports.korapayWebhook = async (req, res) => {
  const signature = req.headers['x-korapay-signature'];
  if (!signature) {
    console.warn('[korapayWebhook] missing x-korapay-signature header', {
      ip:      req.ip,
      ts:      new Date().toISOString(),
      headers: req.headers,
    });
    return res.status(401).end();
  }

  // Verify HMAC-SHA256 signature
  const expected = crypto
    .createHmac('sha256', process.env.KORAPAY_WEBHOOK_SECRET)
    .update(req.body)   // req.body is a Buffer when express.raw() is used
    .digest('hex');

  let signatureMatch;
  try {
    signatureMatch = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    signatureMatch = false;
  }

  if (!signatureMatch) {
    console.warn('[korapayWebhook] invalid signature', { ip: req.ip, ts: new Date().toISOString() });
    return res.status(401).end();
  }

  // Parse body now that signature is verified
  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).end();
  }

  const { event, data } = payload;
  console.log('[korapayWebhook] event:', event, 'ref:', data?.reference);

  // Always acknowledge immediately — process asynchronously
  res.status(200).end();

  try {
    if (event === 'charge.success') {
      await handleChargeSuccess(data);
    } else if (event === 'charge.failed') {
      await handleChargeFailed(data);
    } else if (event === 'refund.success') {
      await handleRefundSuccess(data);
    }
    // All other events: logged above, no action needed
  } catch (err) {
    console.error('[korapayWebhook] processing error for event', event, ':', err.message);
  }
};

// ─── Event handlers ───────────────────────────────────────────────────────────

const handleChargeSuccess = async (data) => {
  const tx = await Transaction.findOne({ reference: data.reference });
  if (!tx) {
    console.warn('[korapayWebhook] charge.success — unknown reference:', data.reference);
    return;
  }
  if (tx.status === 'success') {
    // Idempotent — already processed
    return;
  }

  const safe = { status: data.status, amount: data.amount, currency: data.currency, reference: data.reference };
  await Transaction.findByIdAndUpdate(tx._id, { providerResponse: safe });
  await helper.processSuccess(tx._id);
  console.log('[korapayWebhook] charge.success processed — ref:', data.reference);
};

const handleChargeFailed = async (data) => {
  const tx = await Transaction.findOne({ reference: data.reference });
  if (!tx || tx.status !== 'pending') return; // idempotent
  await helper.processFailure(tx._id, data.message || 'charge.failed event');
  console.log('[korapayWebhook] charge.failed processed — ref:', data.reference);
};

const handleRefundSuccess = async (data) => {
  // data.reference is the refund reference from Kora Pay
  await helper.processRefund(data.reference);
  console.log('[korapayWebhook] refund.success processed — ref:', data.reference);
};
