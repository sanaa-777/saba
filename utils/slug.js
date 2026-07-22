// Shared slug utility — used by all modules for consistent slug generation

/**
 * Generate URL-friendly slug from title
 * Supports Arabic and English text
 * @param {string} title
 * @returns {string} slug
 */
function makeSlug(title) {
  return String(title || '')
    .trim()
    .replace(/[\s]+/g, '-')
    .replace(/[^\w\u0600-\u06FF-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80)
    .toLowerCase();
}

module.exports = { makeSlug };
