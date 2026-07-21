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
  return raw
    .map((value) => parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function buildSlug(title = '') {
  return String(title)
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 80);
}

function buildPublishedAt(status, existingPublishedAt = null) {
  return normalizeStatus(status) === 1
    ? (existingPublishedAt || new Date().toISOString().slice(0, 19).replace('T', ' '))
    : null;
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
    if (existing) {
      db.prepare('UPDATE slider SET title = ?, summary = ?, link = ?, is_active = 1 WHERE id = ?').run(title, summary || '', link, existing.id);
    }
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

function syncNewsRelations(db, payload) {
  syncSlider(db, payload);
  syncBreaking(db, payload);
}

function createNews(db, payload) {
  const status = normalizeStatus(payload.status, 1);
  const isBreaking = normalizeFlag(payload.is_breaking);
  const isSlider = normalizeFlag(payload.is_slider);
  const isFeatured = normalizeFlag(payload.is_featured);
  const publishedAt = buildPublishedAt(status, null);
  const slug = buildSlug(payload.title);

  const result = db.prepare(`INSERT INTO news (title, summary, content, image, category_id, source, is_breaking, is_slider, is_featured, status, published_at, created_at, updated_at, meta_title, meta_description, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?)`).run(
    payload.title,
    payload.summary || '',
    payload.content,
    payload.image || null,
    payload.category_id || null,
    payload.source || 'أوتر',
    isBreaking,
    isSlider,
    isFeatured,
    status,
    publishedAt,
    payload.meta_title || '',
    payload.meta_description || '',
    slug
  );

  const newsId = result.lastInsertRowid;
  syncNewsTags(db, newsId, payload.tags);
  syncNewsRelations(db, { newsId, title: payload.title, summary: payload.summary, image: payload.image || null, is_breaking: isBreaking, is_slider: isSlider });

  return newsId;
}

function updateNews(db, newsId, payload) {
  const existing = db.prepare('SELECT * FROM news WHERE id = ?').get(newsId);
  if (!existing) return null;

  const status = normalizeStatus(payload.status, existing.status || 1);
  const isBreaking = normalizeFlag(payload.is_breaking);
  const isSlider = normalizeFlag(payload.is_slider);
  const isFeatured = normalizeFlag(payload.is_featured);
  const publishedAt = buildPublishedAt(status, existing.published_at);
  const slug = buildSlug(payload.title);
  const image = payload.image !== undefined ? payload.image : existing.image;

  db.prepare(`UPDATE news SET title=?, summary=?, content=?, image=?, category_id=?, source=?, is_breaking=?, is_slider=?, is_featured=?, status=?, published_at=?, updated_at=CURRENT_TIMESTAMP, meta_title=?, meta_description=?, slug=? WHERE id=?`).run(
    payload.title,
    payload.summary || '',
    payload.content,
    image || null,
    payload.category_id || null,
    payload.source || 'أوتر',
    isBreaking,
    isSlider,
    isFeatured,
    status,
    publishedAt,
    payload.meta_title || '',
    payload.meta_description || '',
    slug,
    newsId
  );

  syncNewsTags(db, newsId, payload.tags);
  syncNewsRelations(db, { newsId, title: payload.title, summary: payload.summary, image: image || null, is_breaking: isBreaking, is_slider: isSlider });

  return { ...existing, id: newsId, image };
}

function deleteNews(db, newsId) {
  db.prepare('DELETE FROM news_tags WHERE news_id = ?').run(newsId);
  db.prepare('DELETE FROM slider WHERE news_id = ?').run(newsId);
  db.prepare('DELETE FROM breaking_news WHERE link = ?').run(`/news/${newsId}`);
  db.prepare('DELETE FROM news WHERE id = ?').run(newsId);
}

module.exports = {
  createNews,
  updateNews,
  deleteNews,
  normalizeTagIds,
  buildSlug
};
