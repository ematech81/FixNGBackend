/**
 * Canonical subscription plan definitions.
 * Prices are in Naira (₦). paystackAmount is in kobo (× 100).
 */
const PLANS = {
  free: {
    id:          'free',
    name:        'Free',
    price:       0,
    currency:    '₦',
    interval:    null,
    description: 'Get started on FixNG at no cost.',
    features: [
      'Basic marketplace access',
      'Post up to 3 jobs per month',
      '5 direct artisan requests per month',
      'Standard search placement',
      'In-app chat with artisans',
    ],
    limits: { directRequests: 5, jobPosts: 3 },
  },
  pro: {
    id:              'pro',
    name:            'Artisan Pro',
    price:           3500,
    paystackAmount:  350000,   // kobo
    currency:        '₦',
    interval:        'monthly',
    description:     'Grow your artisan business faster.',
    badge:           'Pro',
    badgeColor:      '#2563EB',
    features: [
      'Unlimited direct job requests',
      'Priority placement in search results',
      '"Pro Artisan" badge on your profile',
      'Acceptance rate shown to customers',
      'Monthly earnings summary',
      'Post unlimited jobs',
    ],
    limits: { directRequests: -1, jobPosts: -1 },
  },
  elite: {
    id:              'elite',
    name:            'Artisan Elite',
    price:           7500,
    paystackAmount:  750000,   // kobo
    currency:        '₦',
    interval:        'monthly',
    description:     'Maximum visibility. Maximum earnings.',
    badge:           'Elite',
    badgeColor:      '#F59E0B',
    features: [
      'Everything in Artisan Pro',
      'Featured on the Home Screen',
      '"Elite Artisan" badge on your profile',
      'Advanced analytics & insights dashboard',
      'Guaranteed top-3 search placement',
      'Priority customer support',
    ],
    limits: { directRequests: -1, jobPosts: -1 },
  },
};

module.exports = PLANS;
