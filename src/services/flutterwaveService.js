const axios = require('axios');

const FLW_BASE   = 'https://api.flutterwave.com/v3';
const secret     = () => process.env.FLW_SECRET_KEY;
const authHeader = () => ({ Authorization: `Bearer ${secret()}` });

const makeTxRef = (userId) => `FIXNG-${userId}-${Date.now()}`;

/**
 * Initialize a Flutterwave payment.
 * Amounts are in Naira (not kobo — Flutterwave uses real currency).
 * Returns { payment_link, tx_ref }
 */
const initializePayment = async ({ email, name, amount, planId, userId }) => {
  const tx_ref = makeTxRef(userId);

  const { data } = await axios.post(
    `${FLW_BASE}/payments`,
    {
      tx_ref,
      amount,
      currency:     'NGN',
      redirect_url: 'https://fixng.app/payment/callback',
      customer:     { email, name },
      customizations: {
        title:       'FixNG Pro Subscription',
        description: `${planId} subscription`,
      },
      meta: { userId, plan: planId },
    },
    { headers: authHeader() }
  );

  return { payment_link: data.data.link, tx_ref };
};

/**
 * Verify a transaction by tx_ref.
 * Returns the full transaction object: { status, currency, amount, meta: { userId, plan } }
 */
const verifyPayment = async (tx_ref) => {
  const { data } = await axios.get(
    `${FLW_BASE}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(tx_ref)}`,
    { headers: authHeader() }
  );
  return data.data;
};

module.exports = { initializePayment, verifyPayment };
