'use strict';

const axios = require('axios');

const BASE    = 'https://api.korapay.com/merchant/api/v1';
const secret  = () => process.env.KORAPAY_SECRET_KEY;
const headers = () => ({ Authorization: `Bearer ${secret()}` });

/**
 * Initialize a Kora Pay charge.
 * @param {object} opts
 * @param {string} opts.reference     - Unique transaction reference
 * @param {number} opts.amountNGN     - Amount in Naira (will be converted to kobo)
 * @param {string} opts.email
 * @param {string} opts.name
 * @param {string} opts.cycle         - 'monthly' | 'quarterly' | 'yearly'
 * @param {string} opts.artisanId     - MongoDB ObjectId string
 * @param {string} opts.notificationUrl
 * @param {string} opts.redirectUrl
 * @returns {{ checkout_url: string }}
 */
const initializeCharge = async ({ reference, amountNGN, email, name, cycle, artisanId, notificationUrl, redirectUrl }) => {
  const payload = {
    reference,
    amount:           amountNGN,          // Kora Pay expects Naira (not kobo unlike Flutterwave)
    currency:         'NGN',
    notification_url: notificationUrl,
    redirect_url:     redirectUrl,
    customer: { email, name },
    metadata: { artisanId, cycle },
  };

  console.log('[KoraPay] initializeCharge request:', JSON.stringify({
    reference: payload.reference,
    amount:    payload.amount,
    currency:  payload.currency,
    email:     payload.customer.email,
    name:      payload.customer.name,
    redirect_url: payload.redirect_url,
  }));

  // Use validateStatus:true so we always get the response body, even on errors
  const response = await axios.post(
    `${BASE}/charges/initialize`,
    payload,
    { headers: headers(), validateStatus: () => true }
  );

  console.log('[KoraPay] initializeCharge response:', response.status, JSON.stringify(response.data));

  if (response.status !== 200 || response.data?.status !== true || !response.data?.data?.checkout_url) {
    const err = new Error(response.data?.message || `Kora Pay returned HTTP ${response.status}`);
    err.korapayStatus = response.status;
    err.korapayData   = response.data;
    throw err;
  }

  return { checkout_url: response.data.data.checkout_url };
};

/**
 * Verify a charge by its reference.
 * @returns {object} Kora Pay charge object
 */
const verifyCharge = async (reference) => {
  const { data } = await axios.get(
    `${BASE}/charges/${encodeURIComponent(reference)}`,
    { headers: headers() }
  );

  if (data.status !== true) {
    throw new Error(data.message || 'Kora Pay verification failed.');
  }

  return data.data;
};

/**
 * Initiate a refund for a successful charge.
 * @param {object} opts
 * @param {string} opts.reference      - Original transaction reference
 * @param {number} opts.amountNGN      - Refund amount in Naira
 * @param {string} opts.reason
 * @returns {object} Kora Pay refund object
 */
const initiateRefund = async ({ reference, amountNGN, reason }) => {
  const { data } = await axios.post(
    `${BASE}/refunds`,
    {
      transaction_reference: reference,
      amount: amountNGN,   // Kora Pay expects Naira
      reason,
    },
    { headers: headers() }
  );

  if (data.status !== true) {
    throw new Error(data.message || 'Kora Pay refund initiation failed.');
  }

  return data.data;
};

module.exports = { initializeCharge, verifyCharge, initiateRefund };
