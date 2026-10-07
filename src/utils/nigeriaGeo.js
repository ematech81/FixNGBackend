'use strict';

// Location helpers for artisans who don't share GPS.
//
// Problem this solves: when an artisan skipped GPS, the old code saved the geographic
// centre of Nigeria (9.082, 8.6753). Every "near me" search filters by distance, so
// those artisans never matched anyone outside central Nigeria — they were invisible.
// Now we geocode the address they typed, falling back to their state's main city.

const axios = require('axios');

const NIGERIA_CENTRE = { lat: 9.082, lng: 8.6753 };

// Main city of each state (where most artisans and customers actually are).
// Only used when the address can't be geocoded; marked geoSource:'state' so the
// API doesn't show a misleading "distance" for them.
const STATE_CENTRES = {
  'Abia': [5.5320, 7.4860], 'Adamawa': [9.2035, 12.4954], 'Akwa Ibom': [5.0377, 7.9128],
  'Anambra': [6.2100, 7.0700], 'Bauchi': [10.3158, 9.8442], 'Bayelsa': [4.9267, 6.2676],
  'Benue': [7.7322, 8.5391], 'Borno': [11.8311, 13.1510], 'Cross River': [4.9517, 8.3220],
  'Delta': [5.5320, 5.8987], 'Ebonyi': [6.3249, 8.1137], 'Edo': [6.3350, 5.6037],
  'Ekiti': [7.6211, 5.2214], 'Enugu': [6.4584, 7.5464], 'FCT': [9.0765, 7.3986],
  'Gombe': [10.2897, 11.1673], 'Imo': [5.4836, 7.0333], 'Jigawa': [11.7564, 9.3389],
  'Kaduna': [10.5105, 7.4165], 'Kano': [12.0022, 8.5920], 'Katsina': [12.9908, 7.6018],
  'Kebbi': [12.4539, 4.1975], 'Kogi': [7.8023, 6.7333], 'Kwara': [8.4966, 4.5421],
  'Lagos': [6.5244, 3.3792], 'Nasarawa': [8.4900, 8.5200], 'Niger': [9.6139, 6.5569],
  'Ogun': [7.1475, 3.3619], 'Ondo': [7.2571, 5.2058], 'Osun': [7.7827, 4.5418],
  'Oyo': [7.3775, 3.9470], 'Plateau': [9.8965, 8.8583], 'Rivers': [4.8156, 7.0498],
  'Sokoto': [13.0059, 5.2476], 'Taraba': [8.8932, 11.3596], 'Yobe': [11.7469, 11.9608],
  'Zamfara': [12.1704, 6.6641],
};

const toRad = (d) => (d * Math.PI) / 180;
const haversineKm = (lat1, lng1, lat2, lng2) => {
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/** True for the old "Nigeria centre" placeholder and for unset [0,0] coordinates. */
const isDefaultCoords = (coords) => {
  if (!Array.isArray(coords) || coords.length !== 2) return true;
  const [lng, lat] = coords;
  if (lng === 0 && lat === 0) return true;
  return Math.abs(lat - NIGERIA_CENTRE.lat) < 0.01 && Math.abs(lng - NIGERIA_CENTRE.lng) < 0.01;
};

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
// A result more than this far from the state's main city is almost certainly the wrong place
// (e.g. a "Adeniyi Street" in another state), so we ignore it.
const MAX_KM_FROM_STATE_CENTRE = 350;

const lookup = async (query, timeout) => {
  const { data } = await axios.get(NOMINATIM, {
    params: { q: query, format: 'json', limit: 1, countrycodes: 'ng' },
    headers: { 'User-Agent': 'FixNG/1.0 (info@fixng.com.ng)', 'Accept-Language': 'en' },
    timeout,
  });
  const hit = Array.isArray(data) ? data[0] : null;
  if (!hit) return null;
  const lat = parseFloat(hit.lat);
  const lng = parseFloat(hit.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

/**
 * Best-effort coordinates for an artisan without GPS. Never throws.
 * @returns {{lat:number, lng:number, source:'address'|'lga'|'state'|'default'}}
 */
const geocodeNigeria = async ({ address, lga, state }) => {
  const centre = STATE_CENTRES[state];
  const accept = (p) => !centre || haversineKm(p.lat, p.lng, centre[0], centre[1]) <= MAX_KM_FROM_STATE_CENTRE;

  const attempts = [
    { source: 'address', q: [address, lga, state && `${state} State`, 'Nigeria'], timeout: 3000 },
    { source: 'lga',     q: [lga, state && `${state} State`, 'Nigeria'],          timeout: 2000 },
  ];

  for (const { source, q, timeout } of attempts) {
    if (source === 'lga' && !lga) continue;
    try {
      const p = await lookup(q.filter(Boolean).join(', '), timeout);
      if (p && accept(p)) return { ...p, source };
    } catch { /* fall through to the next attempt / state fallback */ }
  }

  if (centre) return { lat: centre[0], lng: centre[1], source: 'state' };
  return { ...NIGERIA_CENTRE, source: 'default' };
};

module.exports = { NIGERIA_CENTRE, STATE_CENTRES, isDefaultCoords, geocodeNigeria, haversineKm };
