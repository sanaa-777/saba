const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '../locales');
const supportedLangs = ['ar', 'en', 'fr', 'es', 'de', 'fa'];
const defaultLang = 'ar';

// Load all translations
const translations = {};
supportedLangs.forEach(lang => {
  const filePath = path.join(localesDir, `${lang}.json`);
  if (fs.existsSync(filePath)) {
    translations[lang] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
});

function languageMiddleware(req, res, next) {
  // Get language from: query param > cookie > header > default
  let lang = req.query.lang || req.cookies?.lang || getLangFromHeader(req.headers['accept-language']) || defaultLang;

  // Validate language
  if (!supportedLangs.includes(lang)) {
    lang = defaultLang;
  }

  // Set language in response locals
  req.lang = lang;
  res.locals.lang = lang;
  res.locals.supportedLangs = supportedLangs;
  res.locals.currentLang = lang;

  // Translation function
  res.locals.t = function(key) {
    return (translations[lang] && translations[lang][key]) || (translations[defaultLang] && translations[defaultLang][key]) || key;
  };

  // Get all translations for current language (for templates)
  res.locals.translations = translations[lang] || translations[defaultLang] || {};

  // Set cookie for persistence
  res.cookie('lang', lang, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: true });

  // Set RTL direction
  res.locals.isRTL = ['ar', 'fa'].includes(lang);
  res.locals.direction = res.locals.isRTL ? 'rtl' : 'ltr';

  next();
}

function getLangFromHeader(acceptLanguage) {
  if (!acceptLanguage) return null;
  const preferred = acceptLanguage.split(',')[0].split(';')[0].trim().toLowerCase();
  const shortLang = preferred.split('-')[0];
  return supportedLangs.includes(shortLang) ? shortLang : null;
}

module.exports = { languageMiddleware, supportedLangs, translations };
