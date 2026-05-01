const axios = require('axios');

const BASE = 'https://api.paystack.co';

const headers = () => ({
  Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
  'Content-Type': 'application/json',
});

/**
 * Initialize a Paystack transaction.
 * Pass planCode to auto-create a recurring subscription after first charge.
 * Returns { authorization_url, access_code, reference }
 */
const initializeTransaction = async ({ email, amountKobo, planCode, metadata = {}, callbackUrl }) => {
  const body = {
    email,
    amount:       amountKobo,
    currency:     'NGN',
    metadata,
    callback_url: callbackUrl || process.env.PAYSTACK_CALLBACK_URL,
  };
  if (planCode) body.plan = planCode;

  const res = await axios.post(`${BASE}/transaction/initialize`, body, { headers: headers() });
  return res.data.data;
};

/**
 * Verify a transaction by reference.
 * Returns the full transaction object including subscription details if applicable.
 */
const verifyTransaction = async (reference) => {
  const res = await axios.get(
    `${BASE}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: headers() }
  );
  return res.data.data;
};

/**
 * Disable (cancel) a Paystack subscription.
 * Requires the subscription code and the email token Paystack sends to the customer.
 */
const disableSubscription = async (subscriptionCode, emailToken) => {
  const res = await axios.post(
    `${BASE}/subscription/disable`,
    { code: subscriptionCode, token: emailToken },
    { headers: headers() }
  );
  return res.data;
};

/**
 * Fetch a Paystack subscription by its code.
 */
const fetchSubscription = async (subscriptionCode) => {
  const res = await axios.get(
    `${BASE}/subscription/${encodeURIComponent(subscriptionCode)}`,
    { headers: headers() }
  );
  return res.data.data;
};

module.exports = { initializeTransaction, verifyTransaction, disableSubscription, fetchSubscription };
