const PLANS = {
  free: {
    id:          'free',
    name:        'Free',
    price:       0,
    currency:    '₦',
    interval:    null,
    description: 'Get started on FixNG at no cost.',
    features: [
      'Up to 2 active jobs at a time',
      '5 direct artisan requests per month',
      'Basic search placement',
      'In-app chat with customers',
      'Standard support',
    ],
    limits: { activeJobs: 2, directRequests: 5 },
  },

  basic: {
    id:          'basic',
    name:        'Basic',
    price:       3000,   // Naira — passed directly to Flutterwave
    currency:    '₦',
    interval:    'monthly',
    description: 'Grow your artisan business faster.',
    badge:       'Pro',
    badgeColor:  '#2563EB',
    features: [
      'Up to 10 active jobs simultaneously',
      'Unlimited direct job requests',
      'Priority placement in search results',
      '"Verified Pro" badge on your profile',
      'Acceptance rate visible to customers',
      'Monthly earnings summary',
      'Standard support',
    ],
    limits: { activeJobs: 10, directRequests: -1 },
  },

  premium: {
    id:          'premium',
    name:        'Premium',
    price:       5000,   // Naira — passed directly to Flutterwave
    currency:    '₦',
    interval:    'monthly',
    description: 'Maximum visibility. Maximum earnings.',
    badge:       'Premium',
    badgeColor:  '#F59E0B',
    features: [
      'Unlimited active jobs simultaneously',
      'Everything in Basic',
      'Featured on customer home screen',
      '"Premium" badge on your profile',
      'Guaranteed top-3 search placement',
      'Advanced analytics & insights',
      'Featured in category spotlights',
      'Priority customer support',
    ],
    limits: { activeJobs: -1, directRequests: -1 },
  },
};

module.exports = PLANS;
