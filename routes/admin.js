const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/init');
const { requireAuth } = require('../middleware/auth');

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../public/images/uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|mp3|wav|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname || mimetype) return cb(null, true);
    cb(new Error('نوع الملف غير مسموح'));
  }
});

// Login page
router.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin');
  res.render('admin/login', { title: 'تسجيل الدخول', error: null });
});

// Login POST
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const db = getDb();
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('admin/login', { title: 'تسجيل الدخول', error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }

  db.prepare('UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  req.session.admin = { id: user.id, username: user.username, name: user.name, role: user.role };
  res.redirect('/admin');
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// Dashboard
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const stats = {
    totalNews: db.prepare('SELECT COUNT(*) as cnt FROM news').get().cnt,
    publishedNews: db.prepare('SELECT COUNT(*) as cnt FROM news WHERE status = 1').get().cnt,
    draftNews: db.prepare('SELECT COUNT(*) as cnt FROM news WHERE status = 0').get().cnt,
    totalCategories: db.prepare('SELECT COUNT(*) as cnt FROM categories').get().cnt,
    totalTags: db.prepare('SELECT COUNT(*) as cnt FROM tags').get().cnt,
    totalMedia: db.prepare('SELECT COUNT(*) as cnt FROM media').get().cnt,
    totalViews: db.prepare('SELECT COALESCE(SUM(views), 0) as total FROM news').get().total,
    breakingNews: db.prepare('SELECT COUNT(*) as cnt FROM breaking_news WHERE is_active = 1').get().cnt,
    totalComments: db.prepare('SELECT COUNT(*) as cnt FROM comments').get().cnt,
    pendingComments: db.prepare('SELECT COUNT(*) as cnt FROM comments WHERE status = 0').get().cnt,
    totalPolls: db.prepare('SELECT COUNT(*) as cnt FROM polls').get().cnt,
    totalSubscribers: db.prepare('SELECT COUNT(*) as cnt FROM newsletter_subscribers WHERE is_active = 1').get().cnt
  };
  const recentNews = db.prepare(`SELECT n.*, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id ORDER BY n.created_at DESC LIMIT 10`).all();
  res.render('admin/dashboard', { title: 'لوحة التحكم', admin: req.session.admin, stats, recentNews });
});

// News list
router.get('/news', requireAuth, (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page) || 1;
  const perPage = 20;
  const offset = (page - 1) * perPage;
  const status = req.query.status;
  const category = req.query.category;

  let where = 'WHERE 1=1';
  let params = [];
  if (status !== undefined && status !== '') { where += ' AND n.status = ?'; params.push(status); }
  if (category) { where += ' AND n.category_id = ?'; params.push(category); }

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM news n ${where}`).get(...params).cnt;
  const totalPages = Math.ceil(total / perPage);
  const news = db.prepare(`SELECT n.*, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id ${where} ORDER BY n.created_at DESC LIMIT ? OFFSET ?`).all(...params, perPage, offset);
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();

  res.render('admin/news-list', { title: 'إدارة الأخبار', admin: req.session.admin, news, categories, pagination: { page, totalPages, total }, filters: { status, category } });
});

// News create form
router.get('/news/create', requireAuth, (req, res) => {
  const db = getDb();
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
  const tags = db.prepare('SELECT * FROM tags ORDER BY name').all();
  res.render('admin/news-form', { title: 'إضافة خبر', admin: req.session.admin, categories, tags, article: null });
});

// News create POST
router.post('/news/create', requireAuth, upload.single('image'), (req, res) => {
  const db = getDb();
  const { title, summary, content, category_id, source, is_breaking, is_slider, is_featured, status, meta_title, meta_description, tags } = req.body;
  const image = req.file ? '/images/uploads/' + req.file.filename : null;
  const slug = title.replace(/\s+/g, '-').substring(0, 80);
  const publishedAt = status === '1' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;

  const result = db.prepare(`INSERT INTO news (title, summary, content, image, category_id, source, is_breaking, is_slider, is_featured, status, published_at, created_at, updated_at, meta_title, meta_description, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?)`).run(
    title, summary, content, image, category_id || null, source, is_breaking ? 1 : 0, is_slider ? 1 : 0, is_featured ? 1 : 0, status ? parseInt(status) : 1, publishedAt, meta_title, meta_description, slug
  );

  // Handle tags
  if (tags) {
    const tagIds = Array.isArray(tags) ? tags.map(Number) : [parseInt(tags)];
    const insertTag = db.prepare('INSERT OR IGNORE INTO news_tags (news_id, tag_id) VALUES (?, ?)');
    for (const tagId of tagIds) {
      insertTag.run(result.lastInsertRowid, tagId);
    }
  }

  // Add to slider if flagged
  if (is_slider && image) {
    db.prepare('INSERT INTO slider (news_id, image, title, summary, link, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 0, 1)').run(result.lastInsertRowid, image, title, summary, `/news/${result.lastInsertRowid}`);
  }

  // Add to breaking if flagged
  if (is_breaking) {
    db.prepare('INSERT INTO breaking_news (text, link, is_active, sort_order) VALUES (?, ?, 1, 0)').run(title, `/news/${result.lastInsertRowid}`);
  }

  res.redirect('/admin/news');
});

// News edit form
router.get('/news/edit/:id', requireAuth, (req, res) => {
  const db = getDb();
  const article = db.prepare('SELECT * FROM news WHERE id = ?').get(req.params.id);
  if (!article) return res.redirect('/admin/news');
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
  const tags = db.prepare('SELECT * FROM tags ORDER BY name').all();
  const articleTags = db.prepare('SELECT tag_id FROM news_tags WHERE news_id = ?').all(article.id).map(t => t.tag_id);
  res.render('admin/news-form', { title: 'تعديل خبر', admin: req.session.admin, categories, tags, article, articleTags });
});

// News edit POST
router.post('/news/edit/:id', requireAuth, upload.single('image'), (req, res) => {
  const db = getDb();
  const { title, summary, content, category_id, source, is_breaking, is_slider, is_featured, status, meta_title, meta_description, tags, keep_image } = req.body;
  const existing = db.prepare('SELECT image FROM news WHERE id = ?').get(req.params.id);
  let image = existing ? existing.image : null;
  if (req.file) image = '/images/uploads/' + req.file.filename;
  if (!keep_image && !req.file) image = null;

  const slug = title.replace(/\s+/g, '-').substring(0, 80);
  const publishedAt = status === '1' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;

  db.prepare(`UPDATE news SET title=?, summary=?, content=?, image=?, category_id=?, source=?, is_breaking=?, is_slider=?, is_featured=?, status=?, published_at=COALESCE(?, published_at), updated_at=CURRENT_TIMESTAMP, meta_title=?, meta_description=?, slug=? WHERE id=?`).run(
    title, summary, content, image, category_id || null, source, is_breaking ? 1 : 0, is_slider ? 1 : 0, is_featured ? 1 : 0, status ? parseInt(status) : 1, publishedAt, meta_title, meta_description, slug, req.params.id
  );

  // Update tags
  db.prepare('DELETE FROM news_tags WHERE news_id = ?').run(req.params.id);
  if (tags) {
    const tagIds = Array.isArray(tags) ? tags.map(Number) : [parseInt(tags)];
    const insertTag = db.prepare('INSERT OR IGNORE INTO news_tags (news_id, tag_id) VALUES (?, ?)');
    for (const tagId of tagIds) {
      insertTag.run(req.params.id, tagId);
    }
  }

  res.redirect('/admin/news');
});

// News delete
router.post('/news/delete/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM news_tags WHERE news_id = ?').run(req.params.id);
  db.prepare('DELETE FROM slider WHERE news_id = ?').run(req.params.id);
  db.prepare('DELETE FROM news WHERE id = ?').run(req.params.id);
  res.redirect('/admin/news');
});

// Categories
router.get('/categories', requireAuth, (req, res) => {
  const db = getDb();
  const categories = db.prepare('SELECT *, (SELECT COUNT(*) FROM news WHERE category_id = categories.id) as news_count FROM categories ORDER BY sort_order').all();
  res.render('admin/categories', { title: 'إدارة التصنيفات', admin: req.session.admin, categories });
});

router.post('/categories/create', requireAuth, (req, res) => {
  const db = getDb();
  const { name_ar, name_en, slug, sort_order } = req.body;
  db.prepare('INSERT INTO categories (name_ar, name_en, slug, sort_order) VALUES (?, ?, ?, ?)').run(name_ar, name_en, slug, sort_order || 0);
  res.redirect('/admin/categories');
});

router.post('/categories/edit/:id', requireAuth, (req, res) => {
  const db = getDb();
  const { name_ar, name_en, slug, sort_order, is_active } = req.body;
  db.prepare('UPDATE categories SET name_ar=?, name_en=?, slug=?, sort_order=?, is_active=? WHERE id=?').run(name_ar, name_en, slug, sort_order || 0, is_active ? 1 : 0, req.params.id);
  res.redirect('/admin/categories');
});

router.post('/categories/delete/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE news SET category_id = NULL WHERE category_id = ?').run(req.params.id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.redirect('/admin/categories');
});

// Tags
router.get('/tags', requireAuth, (req, res) => {
  const db = getDb();
  const tags = db.prepare('SELECT *, (SELECT COUNT(*) FROM news_tags WHERE tag_id = tags.id) as usage_count FROM tags ORDER BY name').all();
  res.render('admin/tags', { title: 'إدارة الوسوم', admin: req.session.admin, tags });
});

router.post('/tags/create', requireAuth, (req, res) => {
  const db = getDb();
  const { name, slug } = req.body;
  db.prepare('INSERT INTO tags (name, slug) VALUES (?, ?)').run(name, slug);
  res.redirect('/admin/tags');
});

router.post('/tags/edit/:id', requireAuth, (req, res) => {
  const db = getDb();
  const { name, slug } = req.body;
  db.prepare('UPDATE tags SET name=?, slug=? WHERE id=?').run(name, slug, req.params.id);
  res.redirect('/admin/tags');
});

router.post('/tags/delete/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM news_tags WHERE tag_id = ?').run(req.params.id);
  db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.id);
  res.redirect('/admin/tags');
});

// Media manager
router.get('/media', requireAuth, (req, res) => {
  const db = getDb();
  const type = req.query.type;
  let media;
  if (type) {
    media = db.prepare('SELECT * FROM media WHERE type = ? ORDER BY created_at DESC').all(type);
  } else {
    media = db.prepare('SELECT * FROM media ORDER BY created_at DESC').all();
  }
  res.render('admin/media', { title: 'إدارة الوسائط', admin: req.session.admin, media, filterType: type || '' });
});

router.post('/media/upload', requireAuth, upload.single('file'), (req, res) => {
  const db = getDb();
  if (!req.file) return res.redirect('/admin/media');
  const { title, description, category, type } = req.body;
  const filePath = '/images/uploads/' + req.file.filename;
  let mediaType = type || 'image';
  if (req.file.mimetype.startsWith('video')) mediaType = 'video';
  if (req.file.mimetype.startsWith('audio')) mediaType = 'audio';

  db.prepare('INSERT INTO media (type, title, file_path, description, category, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)').run(
    mediaType, title || req.file.originalname, filePath, description, category
  );
  res.redirect('/admin/media');
});

router.post('/media/delete/:id', requireAuth, (req, res) => {
  const db = getDb();
  const media = db.prepare('SELECT file_path FROM media WHERE id = ?').get(req.params.id);
  if (media) {
    const fullPath = path.join(__dirname, '../public', media.file_path);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  }
  db.prepare('DELETE FROM media WHERE id = ?').run(req.params.id);
  res.redirect('/admin/media');
});

// Breaking news
router.get('/breaking', requireAuth, (req, res) => {
  const db = getDb();
  const breaking = db.prepare('SELECT * FROM breaking_news ORDER BY sort_order').all();
  res.render('admin/breaking', { title: 'الأخبار العاجلة', admin: req.session.admin, breaking });
});

router.post('/breaking/create', requireAuth, (req, res) => {
  const db = getDb();
  const { text, link, is_active, sort_order } = req.body;
  db.prepare('INSERT INTO breaking_news (text, link, is_active, sort_order) VALUES (?, ?, ?, ?)').run(text, link, is_active ? 1 : 0, sort_order || 0);
  res.redirect('/admin/breaking');
});

router.post('/breaking/edit/:id', requireAuth, (req, res) => {
  const db = getDb();
  const { text, link, is_active, sort_order } = req.body;
  db.prepare('UPDATE breaking_news SET text=?, link=?, is_active=?, sort_order=? WHERE id=?').run(text, link, is_active ? 1 : 0, sort_order || 0, req.params.id);
  res.redirect('/admin/breaking');
});

router.post('/breaking/delete/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM breaking_news WHERE id = ?').run(req.params.id);
  res.redirect('/admin/breaking');
});

// Slider
router.get('/slider', requireAuth, (req, res) => {
  const db = getDb();
  const sliderItems = db.prepare('SELECT s.*, n.title as news_title FROM slider s LEFT JOIN news n ON s.news_id = n.id ORDER BY s.sort_order').all();
  const news = db.prepare('SELECT id, title FROM news WHERE status = 1 ORDER BY published_at DESC LIMIT 50').all();
  res.render('admin/slider', { title: 'إدارة السلايدر', admin: req.session.admin, sliderItems, news });
});

router.post('/slider/create', requireAuth, upload.single('image'), (req, res) => {
  const db = getDb();
  const { news_id, title, summary, link, sort_order, is_active } = req.body;
  let image = null;
  if (req.file) image = '/images/uploads/' + req.file.filename;
  else if (news_id) {
    const n = db.prepare('SELECT image FROM news WHERE id = ?').get(news_id);
    if (n) image = n.image;
  }
  db.prepare('INSERT INTO slider (news_id, image, title, summary, link, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    news_id || null, image, title, summary, link, sort_order || 0, is_active ? 1 : 0
  );
  res.redirect('/admin/slider');
});

router.post('/slider/edit/:id', requireAuth, upload.single('image'), (req, res) => {
  const db = getDb();
  const { news_id, title, summary, link, sort_order, is_active, keep_image } = req.body;
  const existing = db.prepare('SELECT image FROM slider WHERE id = ?').get(req.params.id);
  let image = existing ? existing.image : null;
  if (req.file) image = '/images/uploads/' + req.file.filename;
  if (!keep_image && !req.file) image = null;
  db.prepare('UPDATE slider SET news_id=?, image=?, title=?, summary=?, link=?, sort_order=?, is_active=? WHERE id=?').run(
    news_id || null, image, title, summary, link, sort_order || 0, is_active ? 1 : 0, req.params.id
  );
  res.redirect('/admin/slider');
});

router.post('/slider/delete/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM slider WHERE id = ?').run(req.params.id);
  res.redirect('/admin/slider');
});

// Advertisements
router.get('/ads', requireAuth, (req, res) => {
  const db = getDb();
  const ads = db.prepare('SELECT * FROM advertisements ORDER BY position').all();
  res.render('admin/ads', { title: 'إدارة الإعلانات', admin: req.session.admin, ads });
});

router.post('/ads/create', requireAuth, upload.single('image'), (req, res) => {
  const db = getDb();
  const { name, position, code, link, start_date, end_date, is_active } = req.body;
  const image = req.file ? '/images/uploads/' + req.file.filename : null;
  db.prepare('INSERT INTO advertisements (name, position, code, image, link, start_date, end_date, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    name, position, code, image, link, start_date, end_date, is_active ? 1 : 0
  );
  res.redirect('/admin/ads');
});

router.post('/ads/edit/:id', requireAuth, upload.single('image'), (req, res) => {
  const db = getDb();
  const { name, position, code, link, start_date, end_date, is_active, keep_image } = req.body;
  const existing = db.prepare('SELECT image FROM advertisements WHERE id = ?').get(req.params.id);
  let image = existing ? existing.image : null;
  if (req.file) image = '/images/uploads/' + req.file.filename;
  if (!keep_image && !req.file) image = null;
  db.prepare('UPDATE advertisements SET name=?, position=?, code=?, image=?, link=?, start_date=?, end_date=?, is_active=? WHERE id=?').run(
    name, position, code, image, link, start_date, end_date, is_active ? 1 : 0, req.params.id
  );
  res.redirect('/admin/ads');
});

router.post('/ads/delete/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM advertisements WHERE id = ?').run(req.params.id);
  res.redirect('/admin/ads');
});

// Settings
router.get('/settings', requireAuth, (req, res) => {
  const db = getDb();
  const settings = {};
  const rows = db.prepare('SELECT * FROM settings').all();
  rows.forEach(r => { settings[r.key] = r.value; });
  res.render('admin/settings', { title: 'الإعدادات', admin: req.session.admin, settings });
});

router.post('/settings', requireAuth, (req, res) => {
  const db = getDb();
  const update = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(req.body)) {
    update.run(key, value);
  }
  res.redirect('/admin/settings');
});

// Comments management
router.get('/comments', requireAuth, (req, res) => {
  const db = getDb();
  const status = req.query.status;
  let comments;
  if (status !== undefined && status !== '') {
    comments = db.prepare(`SELECT c.*, n.title as news_title FROM comments c LEFT JOIN news n ON c.news_id = n.id WHERE c.status = ? ORDER BY c.created_at DESC`).all(status);
  } else {
    comments = db.prepare(`SELECT c.*, n.title as news_title FROM comments c LEFT JOIN news n ON c.news_id = n.id ORDER BY c.created_at DESC`).all();
  }
  const stats = {
    total: db.prepare('SELECT COUNT(*) as c FROM comments').get().c,
    pending: db.prepare('SELECT COUNT(*) as c FROM comments WHERE status = 0').get().c,
    approved: db.prepare('SELECT COUNT(*) as c FROM comments WHERE status = 1').get().c
  };
  res.render('admin/comments', { title: 'إدارة التعليقات', admin: req.session.admin, comments, stats, filterStatus: status || '' });
});

router.post('/comments/approve/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE comments SET status = 1 WHERE id = ?').run(req.params.id);
  res.redirect('/admin/comments');
});

router.post('/comments/reject/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE comments SET status = 2 WHERE id = ?').run(req.params.id);
  res.redirect('/admin/comments');
});

router.post('/comments/delete/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.redirect('/admin/comments');
});

// Polls management
router.get('/polls', requireAuth, (req, res) => {
  const db = getDb();
  const polls = db.prepare(`SELECT *, (SELECT SUM(votes) FROM poll_options WHERE poll_id = polls.id) as total_votes FROM polls ORDER BY created_at DESC`).all();
  polls.forEach(poll => {
    poll.options = db.prepare('SELECT * FROM poll_options WHERE poll_id = ? ORDER BY id').all(poll.id);
  });
  res.render('admin/polls', { title: 'إدارة الاستطلاعات', admin: req.session.admin, polls });
});

router.post('/polls/create', requireAuth, (req, res) => {
  const db = getDb();
  const { question, options } = req.body;
  if (!question || !options) return res.redirect('/admin/polls');
  
  const result = db.prepare('INSERT INTO polls (question, is_active) VALUES (?, 1)').run(question);
  const optionList = Array.isArray(options) ? options : options.split('\n').filter(o => o.trim());
  const insertOpt = db.prepare('INSERT INTO poll_options (poll_id, option_text, votes) VALUES (?, ?, 0)');
  optionList.forEach(opt => insertOpt.run(result.lastInsertRowid, opt.trim()));
  
  res.redirect('/admin/polls');
});

router.post('/polls/toggle/:id', requireAuth, (req, res) => {
  const db = getDb();
  const poll = db.prepare('SELECT is_active FROM polls WHERE id = ?').get(req.params.id);
  if (poll) {
    db.prepare('UPDATE polls SET is_active = ? WHERE id = ?').run(poll.is_active ? 0 : 1, req.params.id);
  }
  res.redirect('/admin/polls');
});

router.post('/polls/delete/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM poll_votes WHERE poll_id = ?').run(req.params.id);
  db.prepare('DELETE FROM poll_options WHERE poll_id = ?').run(req.params.id);
  db.prepare('DELETE FROM polls WHERE id = ?').run(req.params.id);
  res.redirect('/admin/polls');
});

// Newsletter management
router.get('/newsletter', requireAuth, (req, res) => {
  const db = getDb();
  const subscribers = db.prepare('SELECT * FROM newsletter_subscribers ORDER BY created_at DESC').all();
  const campaigns = db.prepare('SELECT * FROM newsletter_campaigns ORDER BY created_at DESC').all();
  const stats = {
    total: db.prepare('SELECT COUNT(*) as c FROM newsletter_subscribers').get().c,
    active: db.prepare('SELECT COUNT(*) as c FROM newsletter_subscribers WHERE is_active = 1').get().c
  };
  res.render('admin/newsletter', { title: 'النشرة البريدية', admin: req.session.admin, subscribers, campaigns, stats });
});

router.post('/newsletter/send', requireAuth, (req, res) => {
  const db = getDb();
  const { subject, content } = req.body;
  if (!subject || !content) return res.redirect('/admin/newsletter');
  
  const subscribers = db.prepare('SELECT * FROM newsletter_subscribers WHERE is_active = 1').all();
  db.prepare('INSERT INTO newsletter_campaigns (subject, content, sent_at, recipients_count, status) VALUES (?, ?, CURRENT_TIMESTAMP, ?, 1)').run(subject, content, subscribers.length);
  console.log(`Newsletter "${subject}" sent to ${subscribers.length} subscribers`);
  res.redirect('/admin/newsletter');
});

router.post('/newsletter/subscribers/delete/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM newsletter_subscribers WHERE id = ?').run(req.params.id);
  res.redirect('/admin/newsletter');
});

// Admin profile
router.get('/profile', requireAuth, (req, res) => {
  res.render('admin/profile', { title: 'الملف الشخصي', admin: req.session.admin, error: null, success: null });
});

router.post('/profile', requireAuth, (req, res) => {
  const db = getDb();
  const { name, current_password, new_password } = req.body;
  const user = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.session.admin.id);

  if (new_password) {
    if (!bcrypt.compareSync(current_password, user.password)) {
      return res.render('admin/profile', { title: 'الملف الشخصي', admin: req.session.admin, error: 'كلمة المرور الحالية غير صحيحة', success: null });
    }
    const hashed = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE admin_users SET name=?, password=? WHERE id=?').run(name, hashed, req.session.admin.id);
  } else {
    db.prepare('UPDATE admin_users SET name=? WHERE id=?').run(name, req.session.admin.id);
  }

  req.session.admin.name = name;
  res.render('admin/profile', { title: 'الملف الشخصي', admin: req.session.admin, error: null, success: 'تم تحديث الملف الشخصي بنجاح' });
});

module.exports = router;
