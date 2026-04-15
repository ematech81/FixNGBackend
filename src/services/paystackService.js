const axios = require('axios');

const BASE = 'https://api.paystack.co';

const headers = () => ({
  Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
  'Content-Type': 'application/json',
});

/**
 * Initialize a one-time Paystack transaction.
 * Returns { authorization_url, reference, access_code }
 */
const initializeTransaction = async ({ email, amountKobo, metadata = {}, callbackUrl }) => {
  const res = await axios.post(
    `${BASE}/transaction/initialize`,
    {
      email,
      amount:       amountKobo,
      currency:     'NGN',
      metadata,
      callback_url: callbackUrl || process.env.PAYSTACK_CALLBACK_URL,
    },
    { headers: headers() }
  );
  return res.data.data; // { authorization_url, access_code, reference }
};

/**
 * Verify a transaction by reference.
 * Returns the full transaction object from Paystack.
 */
const verifyTransaction = async (reference) => {
  const res = await axios.get(
    `${BASE}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: headers() }
  );
  return res.data.data; // { status: 'success'|'failed', amount, customer, ... }
};

module.exports = { initializeTransaction, verifyTransaction };
