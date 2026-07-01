const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // omits I, L, O, 0, 1 for readability
const CODE_LENGTH = 5;
const MAX_ATTEMPTS = 10;

const makeCode = () => {
  let suffix = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    suffix += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return `FNG-${suffix}`;
};

const generateArtisanCode = async (User) => {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = makeCode();
    const exists = await User.exists({ artisanCode: code });
    if (!exists) return code;
  }
  throw new Error('Could not generate a unique artisan code after 10 attempts.');
};

module.exports = { generateArtisanCode };
