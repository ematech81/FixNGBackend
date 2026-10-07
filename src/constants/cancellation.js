'use strict';

// Job cancellation rules — single source of truth (the API also sends the reason lists to clients).
//
//  pending      customer: free, any time.  artisan: cannot cancel (uses Decline).
//  accepted     customer: free for GRACE_MINUTES after the artisan accepted; after that it is a
//                         "late cancellation" (allowed, recorded, the artisan is told).
//               artisan:  allowed, always recorded against their reliability.
//  in-progress  nobody can cancel — raise a dispute instead.
//  anything else: cannot be cancelled.
//
// Repeated late cancellations trigger an automatic account warning (counted in a rolling window).

const GRACE_MINUTES = 10;

const WARN_RULES = {
  customer: { threshold: 3, windowDays: 30 },  // late cancellations of accepted jobs
  artisan:  { threshold: 3, windowDays: 14 },  // any cancellation of an accepted job
};

const CUSTOMER_REASONS = [
  { code: 'found_other',   label: 'I found another artisan' },
  { code: 'not_needed',    label: 'I no longer need the service' },
  { code: 'mistake',       label: 'I booked by mistake' },
  { code: 'too_slow',      label: 'The artisan is taking too long or not responding' },
  { code: 'artisan_asked', label: 'The artisan asked me to cancel' },
  { code: 'price',         label: 'We could not agree on price or terms' },
  { code: 'schedule',      label: 'My plans or schedule changed' },
  { code: 'other',         label: 'Other reason' },
];

const ARTISAN_REASONS = [
  { code: 'unreachable',    label: 'I cannot reach the customer' },
  { code: 'customer_asked', label: 'The customer asked me to cancel' },
  { code: 'too_far',        label: 'The location is too far for me' },
  { code: 'not_my_skill',   label: 'This job is outside my skills' },
  { code: 'price',          label: 'We could not agree on price or terms' },
  { code: 'unavailable',    label: 'I am no longer available' },
  { code: 'emergency',      label: 'Emergency or personal reason' },
  { code: 'other',          label: 'Other reason' },
];

const reasonsFor = (role) => (role === 'artisan' ? ARTISAN_REASONS : CUSTOMER_REASONS);

module.exports = { GRACE_MINUTES, WARN_RULES, CUSTOMER_REASONS, ARTISAN_REASONS, reasonsFor };
