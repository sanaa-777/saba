const crypto = require('crypto');

function normalizeStatus(status, fallback = 1) {
  if (status === undefined || status === null || status === '') return fallback;
  const parsed = parseInt(status, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function normalizeFlag(value) {
  return value ? 1 : 0;
}

function normalizeTagIds(tags) {
  if (!tags) return [];
  const raw = Array.isArray(tags) ? tags : [tags];
  return raw.map((v) => parseInt(v, 10)).filter((v) => Number.isInteger(v) && v > 0);
}

function makeSlug(title = '') {
  const { makeSlug: slug } = require('../utils/slug');
  return slug(title);
}

function buildPublishedAt(status, existingPublishedAt = null) {
  return normalizeStatus(status) === 1
    ? (existingPublishedAt || new Date().toISOString().slice(0, 19).replace('T', ' '))
    : null;
}

function contentHash(title) {
  return crypto.createHash('md5').update(String(title || '').trim()).digest('hex');
}

function syncNewsTags(db, newsId, tags) {
  db.prepare('DELETE FROM news_tags WHERE news_id = ?').run(newsId);
  const tagIds = normalizeTagIds(tags);
  if (!tagIds.length) return;
  const insertTag = db.prepare('INSERT OR IGNORE INTO news_tags (news_id, tag_id) VALUES (?, ?)');
  tagIds.forEach((tagId) => insertTag.run(newsId, tagId));
}

function syncSlider(db, { newsId, title, summary, image, is_slider }) {
  const link = `/news/${newsId}`;
  if (!is_slider) {
    db.prepare('DELETE FROM slider WHERE news_id = ?').run(newsId);
    return;
  }
  const existing = db.prepare('SELECT id, sort_order FROM slider WHERE news_id = ? ORDER BY id LIMIT 1').get(newsId);
  if (!image) {
    if (existing) db.prepare('UPDATE slider SET title = ?, summary = ?, link = ?, is_active = 1 WHERE id = ?').run(title, summary || '', link, existing.id);
    return;
  }
  if (existing) {
    db.prepare('UPDATE slider SET image = ?, title = ?, summary = ?, link = ?, is_active = 1 WHERE id = ?').run(image, title, summary || '', link, existing.id);
  } else {
    db.prepare('INSERT INTO slider (news_id, image, title, summary, link, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 0, 1)').run(newsId, image, title, summary || '', link);
  }
}

function syncBreaking(db, { newsId, title, is_breaking }) {
  const link = `/news/${newsId}`;
  if (!is_breaking) {
    db.prepare('DELETE FROM breaking_news WHERE link = ?').run(link);
    return;
  }
  const existing = db.prepare('SELECT id, sort_order FROM breaking_news WHERE link = ? ORDER BY id LIMIT 1').get(link);
  if (existing) {
    db.prepare('UPDATE breaking_news SET text = ?, is_active = 1 WHERE id = ?').run(title, existing.id);
  } else {
    db.prepare('INSERT INTO breaking_news (text, link, is_active, sort_order) VALUES (?, ?, 1, 0)').run(title, link);
  }
}

// ─── Track which fields were manually edited ───
function getManualFields(db, newsId) {
  try {
    const row = db.prepare('SELECT manual_fields FROM news WHERE id = ?').get(newsId);
    if (!row || !row.manual_fields) return new Set();
    return new Set(row.manual_fields.split(',').filter(Boolean));
  } catch(e) { return new Set(); }
}

function setManualField(db, newsId, fields) {
  const current = getManualFields(db, newsId);
  fields.forEach(f => current.add(f));
  db.prepare('UPDATE news SET manual_fields = ?, is_manually_edited = 1 WHERE id = ?').run([...current].join(','), newsId);
}

// ─── Create ───
function createNews(db, payload) {
  const { classifyArticle } = require('./categorizer');
  const status = normalizeStatus(payload.status, 1);
  const isBreaking = normalizeFlag(payload.is_breaking);
  const isSlider = normalizeFlag(payload.is_slider);
  const isFeatured = normalizeFlag(payload.is_featured);
  const publishedAt = buildPublishedAt(status, null);
  const slug = makeSlug(payload.title);
  const hash = contentHash(payload.title);

  // Smart categorization if no category provided
  let categoryId = payload.category_id || null;
  if (!categoryId) {
    try {
      categoryId = classifyArticle(payload.title, payload.content, payload.summary, db);
    } catch(e) {}
  }

  const result = db.prepare(`INSERT INTO news (title, summary, content, image, category_id, source, is_breaking, is_slider, is_featured, status, published_at, created_at, updated_at, meta_title, meta_description, slug, content_hash, manual_fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ?, '')`).run(
    payload.title, payload.summary || '', payload.content, payload.image || null,
    payload.category_id || null, payload.source || 'أوتر نيوز',
    isBreaking, isSlider, isFeatured, status, publishedAt,
    payload.meta_title || '', payload.meta_description || '', slug, hash
  );

  const newsId = result.lastInsertRowid;
  syncNewsTags(db, newsId, payload.tags);
  syncSlider(db, { newsId, title: payload.title, summary: payload.summary, image: payload.image || null, is_breaking: isBreaking, is_slider: isSlider });
  syncBreaking(db, { newsId, title: payload.title, is_breaking: isBreaking });
  return newsId;
}

// ─── Update (field-level protection) ───
function updateNews(db, newsId, payload) {
  const existing = db.prepare('SELECT * FROM news WHERE id = ?').get(newsId);
  if (!existing) return null;

  const manualFields = getManualFields(db, newsId);
  const changedFields = [];

  // Detect which fields the user explicitly changed
  const fieldsToCheck = ['title', 'summary', 'content', 'image', 'category_id', 'meta_title', 'meta_description'];
  for (const field of fieldsToCheck) {
    if (payload[field] !== undefined && payload[field] !== existing[field]) {
      changedFields.push(field);
    }
  }

  // Mark changed fields as manually edited
  if (changedFields.length > 0) {
    setManualField(db, newsId, changedFields);
  }

  // Use new values for manually edited fields, existing values for protected fields
  const title = payload.title !== undefined ? payload.title : existing.title;
  const summary = payload.summary !== undefined ? payload.summary : existing.summary;
  const content = payload.content !== undefined ? payload.content : existing.content;
  const image = payload.image !== undefined ? payload.image : existing.image;
  const categoryId = payload.category_id !== undefined ? payload.category_id : existing.category_id;
  const metaTitle = payload.meta_title !== undefined ? payload.meta_title : existing.meta_title;
  const metaDesc = payload.meta_description !== undefined ? payload.meta_description : existing.meta_description;

  const status = normalizeStatus(payload.status, existing.status || 1);
  const isBreaking = normalizeFlag(payload.is_breaking);
  const isSlider = normalizeFlag(payload.is_slider);
  const isFeatured = normalizeFlag(payload.is_featured);
  const publishedAt = buildPublishedAt(status, existing.published_at);
  const slug = makeSlug(title);
  const hash = contentHash(title);

  db.prepare(`UPDATE news SET title=?, summary=?, content=?, image=?, category_id=?, source=?, is_breaking=?, is_slider=?, is_featured=?, status=?, published_at=?, updated_at=CURRENT_TIMESTAMP, meta_title=?, meta_description=?, slug=?, content_hash=?, is_manually_edited=?, manual_fields=? WHERE id=?`).run(
    title, summary || '', content, image || null, categoryId || null,
    payload.source || 'أوتر نيوز', isBreaking, isSlider, isFeatured, status, publishedAt,
    metaTitle || '', metaDesc || '', slug, hash,
    existing.is_manually_edited || 0, existing.manual_fields || '', newsId
  );

  syncNewsTags(db, newsId, payload.tags);
  syncSlider(db, { newsId, title, summary, image: image || null, is_breaking: isBreaking, is_slider: isSlider });
  syncBreaking(db, { newsId, title, is_breaking: isBreaking });
  return { ...existing, id: newsId, image };
}

// ─── Soft Delete (Trash) ───
function trashNews(db, newsId) {
  const article = db.prepare('SELECT id, title, source_url, content_hash FROM news WHERE id = ?').get(newsId);
  if (!article) return false;

  // Record in deleted_articles for deduplication
  try {
    const hash = article.content_hash || contentHash(article.title);
    db.prepare('INSERT INTO deleted_articles (original_id, title, source_url, content_hash, deleted_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)').run(
      article.id, article.title, article.source_url || null, hash
    );
  } catch(e) {}

  // Soft delete
  db.prepare('UPDATE news SET deleted_at = CURRENT_TIMESTAMP, status = 0 WHERE id = ?').run(newsId);
  db.prepare('DELETE FROM slider WHERE news_id = ?').run(newsId);
  db.prepare('DELETE FROM breaking_news WHERE link = ?').run(`/news/${newsId}`);
  return true;
}

// ─── Restore from Trash ───
function restoreNews(db, newsId) {
  const article = db.prepare('SELECT id, deleted_at FROM news WHERE id = ? AND deleted_at IS NOT NULL').get(newsId);
  if (!article) return false;

  db.prepare('UPDATE news SET deleted_at = NULL, status = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newsId);

  // Remove from deleted_articles
  try {
    db.prepare('DELETE FROM deleted_articles WHERE original_id = ?').run(newsId);
  } catch(e) {}

  return true;
}

// ─── Permanent Delete ───
function permanentDeleteNews(db, newsId) {
  const article = db.prepare('SELECT id, title, source_url, content_hash FROM news WHERE id = ?').get(newsId);
  if (!article) return false;

  // Ensure it's in deleted_articles
  try {
    const hash = article.content_hash || contentHash(article.title);
    db.prepare('INSERT OR IGNORE INTO deleted_articles (original_id, title, source_url, content_hash, deleted_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)').run(
      article.id, article.title, article.source_url || null, hash
    );
  } catch(e) {}

  db.prepare('DELETE FROM news_tags WHERE news_id = ?').run(newsId);
  db.prepare('DELETE FROM slider WHERE news_id = ?').run(newsId);
  db.prepare('DELETE FROM breaking_news WHERE link = ?').run(`/news/${newsId}`);
  db.prepare('DELETE FROM comments WHERE news_id = ?').run(newsId);
  db.prepare('DELETE FROM news WHERE id = ?').run(newsId);
  return true;
}

// ─── Legacy deleteNews (redirects to trash) ───
function deleteNews(db, newsId) {
  return trashNews(db, newsId);
}

// ─── Get trashed articles ───
function getTrashedNews(db, { page = 1, limit = 20 } = {}) {
  const total = db.prepare('SELECT COUNT(*) as cnt FROM news WHERE deleted_at IS NOT NULL').get().cnt;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  const news = db.prepare(`SELECT n.*, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id WHERE n.deleted_at IS NOT NULL ORDER BY n.deleted_at DESC LIMIT ? OFFSET ?`).all(limit, offset);
  return { news, total, totalPages, page };
}

// ─── Bulk Operations ───
function bulkAction(db, { ids, action, categoryId, tagIds }) {
  const results = { success: 0, failed: 0 };

  for (const id of ids) {
    try {
      switch (action) {
        case 'publish':
          db.prepare('UPDATE news SET status = 1, published_at = COALESCE(published_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
          results.success++;
          break;
        case 'unpublish':
          db.prepare('UPDATE news SET status = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
          results.success++;
          break;
        case 'trash':
          trashNews(db, id);
          results.success++;
          break;
        case 'restore':
          restoreNews(db, id);
          results.success++;
          break;
        case 'permanent_delete':
          permanentDeleteNews(db, id);
          results.success++;
          break;
        case 'change_category':
          if (categoryId) {
            db.prepare('UPDATE news SET category_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(categoryId, id);
            results.success++;
          }
          break;
        case 'add_tags':
          if (tagIds && tagIds.length) {
            const insertTag = db.prepare('INSERT OR IGNORE INTO news_tags (news_id, tag_id) VALUES (?, ?)');
            tagIds.forEach(tagId => insertTag.run(id, tagId));
            results.success++;
          }
          break;
        default:
          results.failed++;
      }
    } catch(e) {
      results.failed++;
    }
  }
  return results;
}

module.exports = {
  createNews, updateNews, deleteNews, trashNews, restoreNews, permanentDeleteNews,
  getTrashedNews, bulkAction, normalizeTagIds, makeSlug, getManualFields
};
