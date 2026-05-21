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
  const { data } = await axios.post(
    `${BASE}/charges/initialize`,
    {
      reference,
      amount:           amountNGN * 100,   // Kora Pay expects kobo
      currency:         'NGN',
      notification_url: notificationUrl,
      redirect_url:     redirectUrl,
      customer: { email, name },
      metadata: { artisanId, cycle },
    },
    { headers: headers() }
  );

  if (data.status !== true || !data.data?.checkout_url) {
    throw new Error(data.message || 'Kora Pay did not return a checkout URL.');
  }

  return { checkout_url: data.data.checkout_url };
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
      amount: amountNGN * 100,
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
