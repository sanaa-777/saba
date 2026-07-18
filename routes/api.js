const express = require('express');
const router = express.Router();
const { getDb } = require('../db/init');

// ============================================
// PUBLIC API ENDPOINTS
// ============================================

// GET /api/v1/news - Latest news with pagination
router.get('/news', (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const category = req.query.category;

  let where = 'WHERE n.status = 1';
  let params = [];
  if (category) { where += ' AND n.category_id = ?'; params.push(category); }

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM news n ${where}`).get(...params).cnt;
  const news = db.prepare(`
    SELECT n.*, c.name_ar as category_name, c.name_en as category_name_en
    FROM news n LEFT JOIN categories c ON n.category_id = c.id
    ${where} ORDER BY n.published_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({
    success: true,
    data: news,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
});

// GET /api/v1/news/:id - Single article
router.get('/news/:id', (req, res) => {
  const db = getDb();
  const article = db.prepare(`
    SELECT n.*, c.name_ar as category_name, c.name_en as category_name_en, c.id as cat_id
    FROM news n LEFT JOIN categories c ON n.category_id = c.id
    WHERE n.id = ? AND n.status = 1
  `).get(req.params.id);

  if (!article) return res.status(404).json({ success: false, message: 'Article not found' });

  // Increment views
  db.prepare('UPDATE news SET views = views + 1 WHERE id = ?').run(req.params.id);
  article.views += 1;

  // Get tags
  const tags = db.prepare(`SELECT t.* FROM tags t JOIN news_tags nt ON t.id = nt.tag_id WHERE nt.news_id = ?`).all(article.id);

  // Get comments
  const comments = db.prepare(`SELECT * FROM comments WHERE news_id = ? AND status = 1 ORDER BY created_at DESC`).all(article.id);

  // Get related news
  const relatedNews = db.prepare(`
    SELECT n.id, n.title, n.image, n.published_at, n.views, c.name_ar as category_name
    FROM news n LEFT JOIN categories c ON n.category_id = c.id
    WHERE n.category_id = ? AND n.id != ? AND n.status = 1 ORDER BY n.published_at DESC LIMIT 5
  `).all(article.category_id, article.id);

  res.json({ success: true, data: { ...article, tags, comments, relatedNews } });
});

// GET /api/v1/categories - All categories
router.get('/categories', (req, res) => {
  const db = getDb();
  const categories = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM news WHERE category_id = c.id AND status = 1) as news_count
    FROM categories c WHERE c.is_active = 1 ORDER BY c.sort_order
  `).all();
  res.json({ success: true, data: categories });
});

// GET /api/v1/search - Search news
router.get('/search', (req, res) => {
  const db = getDb();
  const { q, category, date_from, date_to, scope, sort, page, limit } = req.query;
  const currentPage = parseInt(page) || 1;
  const perPage = parseInt(limit) || 20;
  const offset = (currentPage - 1) * perPage;

  let where = 'WHERE n.status = 1';
  let params = [];

  if (q) {
    if (scope === 'title') { where += ' AND n.title LIKE ?'; }
    else if (scope === 'content') { where += ' AND n.content LIKE ?'; }
    else { where += ' AND (n.title LIKE ? OR n.content LIKE ? OR n.summary LIKE ?)'; }
    params.push(`%${q}%`);
    if (scope !== 'title' && scope !== 'content') { params.push(`%${q}%`, `%${q}%`); }
  }
  if (category) { where += ' AND n.category_id = ?'; params.push(category); }
  if (date_from) { where += ' AND n.published_at >= ?'; params.push(date_from); }
  if (date_to) { where += ' AND n.published_at <= ?'; params.push(date_to + ' 23:59:59'); }

  let orderBy = 'ORDER BY n.published_at DESC';
  if (sort === 'oldest') orderBy = 'ORDER BY n.published_at ASC';
  if (sort === 'views') orderBy = 'ORDER BY n.views DESC';
  if (sort === 'title') orderBy = 'ORDER BY n.title ASC';

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM news n ${where}`).get(...params).cnt;
  const results = db.prepare(`
    SELECT n.*, c.name_ar as category_name FROM news n
    LEFT JOIN categories c ON n.category_id = c.id
    ${where} ${orderBy} LIMIT ? OFFSET ?
  `).all(...params, perPage, offset);

  res.json({ success: true, data: results, pagination: { page: currentPage, limit: perPage, total, totalPages: Math.ceil(total / perPage) } });
});

// GET /api/v1/breaking - Breaking news
router.get('/breaking', (req, res) => {
  const db = getDb();
  const breaking = db.prepare('SELECT * FROM breaking_news WHERE is_active = 1 ORDER BY sort_order').all();
  res.json({ success: true, data: breaking });
});

// GET /api/v1/slider - Slider items
router.get('/slider', (req, res) => {
  const db = getDb();
  const slider = db.prepare(`
    SELECT s.*, n.title as news_title FROM slider s
    LEFT JOIN news n ON s.news_id = n.id WHERE s.is_active = 1 ORDER BY s.sort_order
  `).all();
  res.json({ success: true, data: slider });
});

// GET /api/v1/media - Media items
router.get('/media', (req, res) => {
  const db = getDb();
  const type = req.query.type;
  let media;
  if (type) {
    media = db.prepare('SELECT * FROM media WHERE type = ? ORDER BY created_at DESC').all(type);
  } else {
    media = db.prepare('SELECT * FROM media ORDER BY created_at DESC').all();
  }
  res.json({ success: true, data: media });
});

// GET /api/v1/tags - All tags
router.get('/tags', (req, res) => {
  const db = getDb();
  const tags = db.prepare('SELECT *, (SELECT COUNT(*) FROM news_tags WHERE tag_id = tags.id) as usage_count FROM tags ORDER BY name').all();
  res.json({ success: true, data: tags });
});

// GET /api/v1/tags/:slug - News by tag
router.get('/tags/:slug', (req, res) => {
  const db = getDb();
  const tag = db.prepare('SELECT * FROM tags WHERE slug = ?').get(req.params.slug);
  if (!tag) return res.status(404).json({ success: false, message: 'Tag not found' });

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  const total = db.prepare('SELECT COUNT(*) as cnt FROM news n JOIN news_tags nt ON n.id = nt.news_id WHERE nt.tag_id = ? AND n.status = 1').get(tag.id).cnt;
  const news = db.prepare(`
    SELECT n.*, c.name_ar as category_name FROM news n
    LEFT JOIN categories c ON n.category_id = c.id
    JOIN news_tags nt ON n.id = nt.news_id
    WHERE nt.tag_id = ? AND n.status = 1 ORDER BY n.published_at DESC LIMIT ? OFFSET ?
  `).all(tag.id, limit, offset);

  res.json({ success: true, tag, data: news, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

// GET /api/v1/polls/active - Active poll
router.get('/polls/active', (req, res) => {
  const db = getDb();
  const poll = db.prepare('SELECT * FROM polls WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1').get();
  if (!poll) return res.json({ success: true, data: null });

  const options = db.prepare('SELECT * FROM poll_options WHERE poll_id = ? ORDER BY id').all(poll.id);
  const totalVotes = db.prepare('SELECT SUM(votes) as total FROM poll_options WHERE poll_id = ?').get(poll.id).total || 0;

  res.json({ success: true, data: { ...poll, options, totalVotes } });
});

// POST /api/v1/polls/vote
router.post('/polls/vote', (req, res) => {
  const db = getDb();
  const { poll_id, option_id } = req.body;
  const ip = req.ip || req.connection.remoteAddress;

  if (!poll_id || !option_id) return res.status(400).json({ success: false, message: 'Invalid data' });

  const existing = db.prepare('SELECT * FROM poll_votes WHERE poll_id = ? AND ip_address = ?').get(poll_id, ip);
  if (existing) return res.status(400).json({ success: false, message: 'Already voted' });

  db.prepare('INSERT INTO poll_votes (poll_id, option_id, ip_address) VALUES (?, ?, ?)').run(poll_id, option_id, ip);
  db.prepare('UPDATE poll_options SET votes = votes + 1 WHERE id = ?').run(option_id);

  const options = db.prepare('SELECT * FROM poll_options WHERE poll_id = ? ORDER BY id').all(poll_id);
  const totalVotes = db.prepare('SELECT SUM(votes) as total FROM poll_options WHERE poll_id = ?').get(poll_id).total || 0;

  res.json({ success: true, data: { options, totalVotes } });
});

// POST /api/v1/comments
router.post('/comments', (req, res) => {
  const db = getDb();
  const { news_id, author_name, author_email, content } = req.body;
  const ip = req.ip || req.connection.remoteAddress;

  if (!news_id || !author_name || !content) return res.status(400).json({ success: false, message: 'Missing fields' });

  db.prepare('INSERT INTO comments (news_id, author_name, author_email, content, status, ip_address) VALUES (?, ?, ?, ?, 0, ?)').run(news_id, author_name, author_email || null, content, ip);
  res.json({ success: true, message: 'Comment submitted for review' });
});

// POST /api/v1/newsletter/subscribe
router.post('/newsletter/subscribe', (req, res) => {
  const db = getDb();
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email required' });

  const existing = db.prepare('SELECT * FROM newsletter_subscribers WHERE email = ?').get(email);
  if (existing) {
    if (existing.is_active) return res.json({ success: true, message: 'Already subscribed' });
    db.prepare('UPDATE newsletter_subscribers SET is_active = 1 WHERE email = ?').run(email);
    return res.json({ success: true, message: 'Re-subscribed' });
  }

  db.prepare('INSERT INTO newsletter_subscribers (email, name, is_active) VALUES (?, ?, 1)').run(email, name || null);
  res.json({ success: true, message: 'Subscribed successfully' });
});

// GET /api/v1/stats - Site statistics
router.get('/stats', (req, res) => {
  const db = getDb();
  res.json({
    success: true,
    data: {
      totalNews: db.prepare('SELECT COUNT(*) as c FROM news WHERE status = 1').get().c,
      totalCategories: db.prepare('SELECT COUNT(*) as c FROM categories WHERE is_active = 1').get().c,
      totalViews: db.prepare('SELECT COALESCE(SUM(views), 0) as c FROM news').get().c,
      totalComments: db.prepare('SELECT COUNT(*) as c FROM comments WHERE status = 1').get().c
    }
  });
});

// GET /api/v1/settings - Public settings
router.get('/settings', (req, res) => {
  const db = getDb();
  const settings = {};
  db.prepare('SELECT * FROM settings').all().forEach(s => { settings[s.key] = s.value; });
  res.json({ success: true, data: settings });
});

module.exports = router;
