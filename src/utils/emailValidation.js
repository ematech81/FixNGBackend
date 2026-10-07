'use strict';

// Stricter than "has an @ and a dot": rejects typos that make an address undeliverable —
// consecutive dots (name@gmail..com), a leading/trailing dot, empty labels, and a TLD that
// isn't letters (name@gmail.c0m). Brevo refuses such addresses, so the person would never
// get job alerts or any email.

const EMAIL_RE = /^[^\s@.]+(?:\.[^\s@.]+)*@[^\s@.]+(?:\.[^\s@.]+)*\.[A-Za-z]{2,}$/;

const isValidEmail = (email) => typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email.trim());

module.exports = { isValidEmail };
