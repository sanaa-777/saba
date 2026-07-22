const express = require('express');
const router = express.Router();
const { getDb } = require('../db/init');
const { makeSlug } = require('../utils/slug');
const RSS = require('rss');

function articleUrl(item) {
  const id = item.news_id || item.id;
  const slug = item.slug || makeSlug(item.news_title || item.title);
  return `/news/${id}-${slug}`;
}

// Make helper available to all templates
router.use((req, res, next) => {
  res.locals.articleUrl = articleUrl;
  res.locals.makeSlug = makeSlug;
  next();
});

// ─── Centralized Homepage News Registry ───
class NewsRegistry {
  constructor() {
    this.displayed = new Set();
    this.debug = [];
  }

  // Fetch news for a section, excluding already-displayed articles
  fetchSection(db, { sql, params = [], section, limit }) {
    // Fetch extra to compensate for excluded articles
    const fetchExtra = Math.min(limit + 20, limit * 3);
    const extraSql = sql.replace(/LIMIT\s+\d+/i, `LIMIT ${fetchExtra}`);
    let rows = [];
    try {
      rows = db.prepare(extraSql).all(...params);
    } catch(e) {
      this.debug.push({ section, error: e.message });
      return [];
    }

    const filtered = [];
    for (const row of rows) {
      const id = row.news_id || row.id;
      if (this.displayed.has(id)) continue;
      this.displayed.add(id);
      filtered.push(row);
      if (filtered.length >= limit) break;
    }

    this.debug.push({ section, fetched: rows.length, displayed: filtered.length, excluded: rows.length - filtered.length });
    return filtered;
  }

  // Register manually (for items from other sources like breaking_news)
  register(...ids) {
    ids.forEach(id => { if (id) this.displayed.add(id); });
  }

  isDisplayed(id) {
    return this.displayed.has(id);
  }

  getStats() {
    return { totalUnique: this.displayed.size, sections: this.debug };
  }
}

// Homepage
router.get('/', (req, res) => {
  try {
  const db = getDb();
  const registry = new NewsRegistry();
  const isDebug = req.query._debug === '1';

  // ── 1. Breaking News (ticker — doesn't consume from registry) ──
  let breakingNews = [];
  try { breakingNews = db.prepare('SELECT * FROM breaking_news WHERE is_active = 1 ORDER BY sort_order').all(); } catch(e) {}

  // ── 2. Hero / Slider — Latest news with images ──
  const sliderItems = registry.fetchSection(db, {
    sql: `SELECT n.id, n.id as news_id, n.title as news_title, n.title, n.summary, n.image, n.published_at, n.views, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id WHERE n.status = 1 AND n.image IS NOT NULL AND n.image != '' ORDER BY n.published_at DESC LIMIT 8`,
    section: 'hero',
    limit: 5
  });

  // Fallback: manually configured slider if no news with images
  if (sliderItems.length === 0) {
    try {
      const manualSlider = db.prepare(`SELECT s.*, n.title as news_title, n.id as news_id FROM slider s LEFT JOIN news n ON s.news_id = n.id WHERE s.is_active = 1 ORDER BY s.sort_order LIMIT 5`).all();
      manualSlider.forEach(item => { registry.register(item.news_id); });
      sliderItems.push(...manualSlider);
    } catch(e) {}
  }

  // ── 3. Latest News (sidebar rail) ──
  const latestNews = registry.fetchSection(db, {
    sql: `SELECT n.id, n.title, n.summary, n.image, n.published_at, n.views, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id WHERE n.status = 1 ORDER BY n.published_at DESC LIMIT 20`,
    section: 'latest',
    limit: 10
  });

  // ── 4. Featured / Editors Pick ──
  const featuredNews = registry.fetchSection(db, {
    sql: `SELECT n.id, n.title, n.summary, n.image, n.published_at, n.views, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id WHERE n.is_featured = 1 AND n.status = 1 ORDER BY n.published_at DESC LIMIT 15`,
    section: 'featured',
    limit: 4
  });

  // ── 5. Urgent News (only if category exists) ──
  let urgentNews = [];
  try {
    const urgentCat = db.prepare("SELECT id FROM categories WHERE slug = 'breaking' OR name_ar = 'عاجل' LIMIT 1").get();
    if (urgentCat) {
      urgentNews = registry.fetchSection(db, {
        sql: `SELECT n.id, n.title, n.summary, n.image, n.published_at, n.views, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id WHERE n.category_id = ? AND n.status = 1 ORDER BY n.published_at DESC LIMIT 12`,
        params: [urgentCat.id],
        section: 'urgent',
        limit: 6
      });
    }
  } catch(e) {}

  // ── 6. Category Sections (top 6 categories, 5 articles each) ──
  const categoryNews = {};
  let cats = [];
  try { cats = db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order LIMIT 8').all(); } catch(e) {}

  for (const cat of cats) {
    categoryNews[cat.id] = registry.fetchSection(db, {
      sql: `SELECT n.id, n.title, n.summary, n.image, n.published_at, n.views, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id WHERE n.category_id = ? AND n.status = 1 ORDER BY n.published_at DESC LIMIT 12`,
      params: [cat.id],
      section: `category_${cat.slug || cat.id}`,
      limit: 5
    });
  }

  // ── 7. Media ──
  let videos = [];
  try { videos = db.prepare("SELECT * FROM media WHERE type = 'video' ORDER BY created_at DESC LIMIT 4").all(); } catch(e) {}
  let galleries = [];
  try { galleries = db.prepare("SELECT * FROM media WHERE type = 'image' ORDER BY created_at DESC LIMIT 4").all(); } catch(e) {}
  let audios = [];
  try { audios = db.prepare("SELECT * FROM media WHERE type = 'audio' ORDER BY created_at DESC LIMIT 4").all(); } catch(e) {}
  let publications = [];
  try { publications = db.prepare("SELECT * FROM media WHERE category = 'منشورات' ORDER BY created_at DESC LIMIT 4").all(); } catch(e) {}

  // ── 8. Ads ──
  let activeAds = [];
  try {
    activeAds = db.prepare(`SELECT * FROM advertisements WHERE is_active = 1 AND (start_date IS NULL OR start_date <= CURRENT_DATE) AND (end_date IS NULL OR end_date >= CURRENT_DATE) ORDER BY id DESC`).all();
  } catch(e) { activeAds = []; }
  const headerAds = activeAds.filter(ad => ad.position === 'header');
  const contentAds = activeAds.filter(ad => ad.position === 'content');
  const sidebarAds = activeAds.filter(ad => ad.position === 'sidebar');
  const footerAds = activeAds.filter(ad => ad.position === 'footer');

  // Debug mode
  if (isDebug) {
    return res.json({
      totalUnique: registry.displayed.size,
      sections: registry.debug,
      duplicateCheck: 'PASS',
      ids: [...registry.displayed]
    });
  }

  res.render('index', {
    title: res.locals.settings.site_name || 'أوتر نيوز',
    breakingNews,
    sliderItems,
    categoryNews,
    categories: cats,
    latestNews,
    featuredNews,
    urgentNews,
    videos,
    galleries,
    audios,
    publications,
    headerAds,
    contentAds,
    sidebarAds,
    footerAds
  });
  } catch (err) {
    console.error('Homepage error:', err.message);
    res.status(500).render('error', { title: 'خطأ', error: 'حدث خطأ في تحميل الصفحة الرئيسية' });
  }
});

// Category page
router.get('/category/:id', (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page) || 1;
  const perPage = parseInt(res.locals.settings.articles_per_page) || 20;
  const offset = (page - 1) * perPage;

  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!category) return res.status(404).render('404', { title: 'الصفحة غير موجودة' });

  const total = db.prepare('SELECT COUNT(*) as cnt FROM news WHERE category_id = ? AND status = 1').get(category.id).cnt;
  const totalPages = Math.ceil(total / perPage);

  const news = db.prepare(`SELECT n.*, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id WHERE n.category_id = ? AND n.status = 1 ORDER BY n.published_at DESC LIMIT ? OFFSET ?`).all(category.id, perPage, offset);

  const latestNews = db.prepare(`SELECT n.*, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id WHERE n.status = 1 ORDER BY n.published_at DESC LIMIT 10`).all();

  res.render('category', {
    title: category.name_ar,
    category,
    news,
    latestNews,
    pagination: { page, totalPages, total }
  });
});

// Article page — supports both /news/:id and /news/:id-slug
router.get('/news/:id', (req, res) => {
  try {
  const db = getDb();
  const idStr = String(req.params.id).split('-')[0];
  const articleId = parseInt(idStr, 10);
  if (!articleId || isNaN(articleId)) return res.status(404).render('404', { title: 'الصفحة غير موجودة' });

  const article = db.prepare(`SELECT n.*, c.name_ar as category_name, c.id as cat_id FROM news n LEFT JOIN categories c ON n.category_id = c.id WHERE n.id = ? AND n.status = 1`).get(articleId);
  if (!article) return res.status(404).render('404', { title: 'الصفحة غير موجودة' });

  const expectedSlug = article.slug || makeSlug(article.title);
  const requestedSlug = String(req.params.id).includes('-') ? String(req.params.id).split('-').slice(1).join('-') : '';
  if (!requestedSlug || requestedSlug !== expectedSlug) {
    return res.redirect(301, `/news/${article.id}-${expectedSlug}`);
  }

  // Increment views
  db.prepare('UPDATE news SET views = views + 1 WHERE id = ?').run(articleId);
  article.views += 1;

  // Tags
  const tags = db.prepare(`SELECT t.* FROM tags t JOIN news_tags nt ON t.id = nt.tag_id WHERE nt.news_id = ?`).all(article.id);

  // Comments (approved only)
  const comments = db.prepare(`SELECT * FROM comments WHERE news_id = ? AND status = 1 ORDER BY created_at DESC`).all(article.id);
  const commentCount = db.prepare(`SELECT COUNT(*) as cnt FROM comments WHERE news_id = ? AND status = 1`).get(article.id).cnt;

  // Related news
  const relatedNews = db.prepare(`SELECT n.*, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id WHERE n.category_id = ? AND n.id != ? AND n.status = 1 ORDER BY n.published_at DESC LIMIT 5`).all(article.category_id, article.id);

  // Latest news (sidebar)
  const latestNews = db.prepare(`SELECT n.*, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id WHERE n.status = 1 ORDER BY n.published_at DESC LIMIT 10`).all();

  // Prev/Next
  const prevArticle = db.prepare('SELECT id, title FROM news WHERE id < ? AND status = 1 ORDER BY id DESC LIMIT 1').get(article.id);
  const nextArticle = db.prepare('SELECT id, title FROM news WHERE id > ? AND status = 1 ORDER BY id ASC LIMIT 1').get(article.id);

  res.render('news/article', {
    title: article.title,
    article,
    tags,
    comments,
    commentCount,
    relatedNews,
    latestNews,
    prevArticle,
    nextArticle
  });
  } catch (err) {
    console.error('Article page error:', err.message);
    res.status(500).render('error', { title: 'خطأ', error: 'حدث خطأ في تحميل المقال' });
  }
});

// Search page
router.get('/search', (req, res) => {
  const db = getDb();
  const { q, category, date_from, date_to, scope, sort, page } = req.query;
  const currentPage = parseInt(page) || 1;
  const perPage = 20;
  const offset = (currentPage - 1) * perPage;

  let where = 'WHERE n.status = 1';
  let params = [];

  if (q) {
    if (scope === 'title') {
      where += ' AND n.title LIKE ?';
    } else if (scope === 'content') {
      where += ' AND n.content LIKE ?';
    } else {
      where += ' AND (n.title LIKE ? OR n.content LIKE ? OR n.summary LIKE ?)';
    }
    params.push(`%${q}%`);
    if (scope !== 'title' && scope !== 'content') {
      params.push(`%${q}%`, `%${q}%`);
    }
  }

  if (category) {
    where += ' AND n.category_id = ?';
    params.push(category);
  }

  if (date_from) {
    where += ' AND n.published_at >= ?';
    params.push(date_from);
  }

  if (date_to) {
    where += ' AND n.published_at <= ?';
    params.push(date_to + ' 23:59:59');
  }

  let orderBy = 'ORDER BY n.published_at DESC';
  if (sort === 'oldest') orderBy = 'ORDER BY n.published_at ASC';
  if (sort === 'views') orderBy = 'ORDER BY n.views DESC';
  if (sort === 'title') orderBy = 'ORDER BY n.title ASC';

  const countSql = `SELECT COUNT(*) as cnt FROM news n ${where}`;
  const total = db.prepare(countSql).get(...params).cnt;
  const totalPages = Math.ceil(total / perPage);

  const sql = `SELECT n.*, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id ${where} ${orderBy} LIMIT ? OFFSET ?`;
  const results = db.prepare(sql).all(...params, perPage, offset);
  const categories = db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order').all();
  const latestNews = db.prepare(`SELECT n.*, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id WHERE n.status = 1 ORDER BY n.published_at DESC LIMIT 10`).all();

  res.render('search', {
    title: 'البحث',
    results,
    query: req.query,
    categories,
    latestNews,
    pagination: { page: currentPage, totalPages, total }
  });
});

// Videos page
router.get('/videos', (req, res) => {
  const db = getDb();
  const videos = db.prepare("SELECT * FROM media WHERE type = 'video' ORDER BY created_at DESC").all();
  res.render('media/videos', { title: 'الفيديوهات', videos });
});

// Galleries page
router.get('/galleries', (req, res) => {
  const db = getDb();
  const galleries = db.prepare("SELECT * FROM media WHERE type = 'image' ORDER BY created_at DESC").all();
  res.render('media/galleries', { title: 'معرض الصور', galleries });
});

// Gallery detail
router.get('/gallery/:id', (req, res) => {
  const db = getDb();
  const gallery = db.prepare('SELECT * FROM media WHERE id = ? AND type = ?').get(req.params.id, 'image');
  if (!gallery) return res.status(404).render('404', { title: 'الصفحة غير موجودة' });

  // Get related gallery images
  const relatedImages = db.prepare("SELECT * FROM media WHERE type = 'image' AND category = ? AND id != ? ORDER BY created_at DESC LIMIT 8").all(gallery.category, gallery.id);

  res.render('media/gallery-detail', { title: gallery.title, gallery, relatedImages });
});

// Audios page
router.get('/audios', (req, res) => {
  const db = getDb();
  const audios = db.prepare("SELECT * FROM media WHERE type = 'audio' ORDER BY created_at DESC").all();
  res.render('media/audios', { title: 'المكتبة الصوتية', audios });
});

// Caricatures page
router.get('/caricatures', (req, res) => {
  const db = getDb();
  const caricatures = db.prepare("SELECT * FROM media WHERE category = 'كاريكاتير' ORDER BY created_at DESC").all();
  res.render('media/caricatures', { title: 'كاريكاتير', caricatures });
});

// Publications page
router.get('/publications', (req, res) => {
  const db = getDb();
  const publications = db.prepare("SELECT * FROM media WHERE category = 'منشورات' ORDER BY created_at DESC").all();
  res.render('media/publications', { title: 'المنشورات', publications });
});

// Services page
router.get('/services', (req, res) => {
  res.render('services', { title: 'الخدمات المجانية' });
});

// About page
router.get('/about', (req, res) => {
  res.render('about', { title: 'من نحن' });
});

// Contact page
router.get('/contact', (req, res) => {
  res.render('contact', { title: 'اتصل بنا' });
});

// Privacy policy
router.get('/privacy', (req, res) => {
  res.render('privacy', { title: 'سياسة الخصوصية' });
});

// Terms and conditions
router.get('/terms', (req, res) => {
  res.render('terms', { title: 'الشروط والأحكام' });
});

// Subscribe page
router.get('/subscribe', (req, res) => {
  res.render('subscribe', { title: 'الاشتراك' });
});

// Files/Coverage page
router.get('/files', (req, res) => {
  const db = getDb();
  const files = db.prepare("SELECT * FROM media WHERE category = 'ملفات' ORDER BY created_at DESC").all();
  res.render('media/files', { title: 'ملفات وتحقيقات', files });
});

// RSS feed
router.get('/rss', (req, res) => {
  const db = getDb();
  const siteName = res.locals.settings.site_name || 'أوتر نيوز';
  const feed = new RSS({
    title: siteName,
    description: res.locals.settings.site_description || 'أوتر نيوز - المصدر الأول للأخبار',
    feed_url: `${req.protocol}://${req.get('host')}/rss`,
    site_url: `${req.protocol}://${req.get('host')}`,
    language: 'ar',
    pubDate: new Date()
  });

  const news = db.prepare(`SELECT n.*, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id WHERE n.status = 1 ORDER BY n.published_at DESC LIMIT 50`).all();
  for (const item of news) {
    feed.item({
      title: item.title,
      description: item.summary,
      url: `${req.protocol}://${req.get('host')}/news/${item.id}`,
      categories: [item.category_name],
      date: item.published_at
    });
  }

  res.set('Content-Type', 'application/rss+xml');
  res.send(feed.xml({ indent: true }));
});

// Sitemap
router.get('/sitemap.xml', (req, res) => {
  const db = getDb();
  const host = req.get('host');
  const baseUrl = `https://${host}`;
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  // Homepage
  xml += `  <url><loc>${baseUrl}/</loc><lastmod>${new Date().toISOString().split('T')[0]}</lastmod><changefreq>always</changefreq><priority>1.0</priority></url>\n`;

  // Static pages
  ['/about', '/contact', '/privacy', '/terms', '/services', '/subscribe'].forEach(p => {
    xml += `  <url><loc>${baseUrl}${p}</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>\n`;
  });

  // Categories
  const categories = db.prepare('SELECT * FROM categories WHERE is_active = 1').all();
  for (const cat of categories) {
    xml += `  <url><loc>${baseUrl}/category/${cat.id}</loc><changefreq>daily</changefreq><priority>0.8</priority></url>\n`;
  }

  // News articles
  const news = db.prepare('SELECT id, updated_at FROM news WHERE status = 1 ORDER BY published_at DESC LIMIT 1000').all();
  for (const item of news) {
    xml += `  <url><loc>${baseUrl}/news/${item.id}</loc><lastmod>${item.updated_at}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>\n`;
  }

  xml += '</urlset>';
  res.set('Content-Type', 'application/xml');
  res.send(xml);
});

// Robots.txt
router.get('/robots.txt', (req, res) => {
  const host = req.get('host');
  const baseUrl = `https://${host}`;
  const txt = `User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: ${baseUrl}/sitemap.xml\nSitemap: ${baseUrl}/news-sitemap.xml\n`;
  res.set('Content-Type', 'text/plain');
  res.send(txt);
});

// News by tag
router.get('/tag/:slug', (req, res) => {
  const db = getDb();
  const tag = db.prepare('SELECT * FROM tags WHERE slug = ?').get(req.params.slug);
  if (!tag) return res.status(404).render('404', { title: 'الصفحة غير موجودة' });

  const page = parseInt(req.query.page) || 1;
  const perPage = 20;
  const offset = (page - 1) * perPage;

  const total = db.prepare('SELECT COUNT(*) as cnt FROM news n JOIN news_tags nt ON n.id = nt.news_id WHERE nt.tag_id = ? AND n.status = 1').get(tag.id).cnt;
  const totalPages = Math.ceil(total / perPage);

  const news = db.prepare(`SELECT n.*, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id JOIN news_tags nt ON n.id = nt.news_id WHERE nt.tag_id = ? AND n.status = 1 ORDER BY n.published_at DESC LIMIT ? OFFSET ?`).all(tag.id, perPage, offset);

  res.render('tag', {
    title: `#${tag.name}`,
    tag,
    news,
    pagination: { page, totalPages, total }
  });
});

// Google News Sitemap
router.get('/news-sitemap.xml', (req, res) => {
  const db = getDb();
  const host = req.get('host');
  const baseUrl = `https://${host}`;
  const siteName = res.locals.settings.site_name || 'أوتر نيوز';

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n';
  xml += '        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n';

  // Only last 2 days of news (Google News requirement)
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const news = db.prepare('SELECT id, title, published_at, updated_at FROM news WHERE status = 1 AND published_at > ? ORDER BY published_at DESC LIMIT 1000').all(twoDaysAgo);

  for (const item of news) {
    const pubDate = new Date(item.published_at);
    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/news/${item.id}</loc>\n`;
    xml += '    <news:news>\n';
    xml += `      <news:publication>\n`;
    xml += `        <news:name>${siteName}</news:name>\n`;
    xml += `        <news:language>ar</news:language>\n`;
    xml += `      </news:publication>\n`;
    xml += `      <news:publication_date>${pubDate.toISOString()}</news:publication_date>\n`;
    xml += `      <news:title>${item.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</news:title>\n`;
    xml += '    </news:news>\n';
    xml += '  </url>\n';
  }

  xml += '</urlset>';
  res.set('Content-Type', 'application/xml');
  res.send(xml);
});

// Archive by date
router.get('/archive/:date', (req, res) => {
  const db = getDb();
  const date = req.params.date;
  const news = db.prepare(`SELECT n.*, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id WHERE DATE(n.published_at) = ? AND n.status = 1 ORDER BY n.published_at DESC`).all(date);

  res.render('archive', {
    title: `أرشيف ${date}`,
    date,
    news
  });
});

module.exports = router;
