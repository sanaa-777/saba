const express = require('express');
const router = express.Router();
const { getDb } = require('../db/init');
const RSS = require('rss');

// Homepage
router.get('/', (req, res) => {
  try {
  const db = getDb();

  // Breaking news
  let breakingNews = [];
  try { breakingNews = db.prepare('SELECT * FROM breaking_news WHERE is_active = 1 ORDER BY sort_order').all(); } catch(e) {}

  // Slider items
  let sliderItems = [];
  try { sliderItems = db.prepare(`SELECT s.*, n.title as news_title, n.id as news_id FROM slider s LEFT JOIN news n ON s.news_id = n.id WHERE s.is_active = 1 ORDER BY s.sort_order LIMIT 5`).all(); } catch(e) {}

  // Latest news by category (limit to top 8 categories to reduce queries)
  const categoryNews = {};
  let cats = [];
  try { cats = db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order LIMIT 8').all(); } catch(e) {}
  for (const cat of cats) {
    try {
      categoryNews[cat.id] = db.prepare(`SELECT n.*, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id WHERE n.category_id = ? AND n.status = 1 ORDER BY n.published_at DESC LIMIT 6`).all(cat.id);
    } catch(e) { categoryNews[cat.id] = []; }
  }

  // Latest news (sidebar)
  let latestNews = [];
  try { latestNews = db.prepare(`SELECT n.*, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id WHERE n.status = 1 ORDER BY n.published_at DESC LIMIT 15`).all(); } catch(e) {}

  let featuredNews = [];
  try { featuredNews = db.prepare(`SELECT n.*, c.name_ar as category_name FROM news n LEFT JOIN categories c ON n.category_id = c.id WHERE n.is_featured = 1 AND n.status = 1 ORDER BY n.published_at DESC LIMIT 10`).all(); } catch(e) {}

  let videos = [];
  try { videos = db.prepare("SELECT * FROM media WHERE type = 'video' ORDER BY created_at DESC LIMIT 4").all(); } catch(e) {}

  let galleries = [];
  try { galleries = db.prepare("SELECT * FROM media WHERE type = 'image' ORDER BY created_at DESC LIMIT 4").all(); } catch(e) {}

  let audios = [];
  try { audios = db.prepare("SELECT * FROM media WHERE type = 'audio' ORDER BY created_at DESC LIMIT 4").all(); } catch(e) {}

  let publications = [];
  try { publications = db.prepare("SELECT * FROM media WHERE category = 'منشورات' ORDER BY created_at DESC LIMIT 4").all(); } catch(e) {}

  let activeAds = [];
  try {
    activeAds = db.prepare(`SELECT * FROM advertisements WHERE is_active = 1 AND (start_date IS NULL OR start_date <= CURRENT_DATE) AND (end_date IS NULL OR end_date >= CURRENT_DATE) ORDER BY id DESC`).all();
  } catch(e) { activeAds = []; }
  const headerAds = activeAds.filter(ad => ad.position === 'header');
  const contentAds = activeAds.filter(ad => ad.position === 'content');
  const sidebarAds = activeAds.filter(ad => ad.position === 'sidebar');
  const footerAds = activeAds.filter(ad => ad.position === 'footer');

  res.render('index', {
    title: res.locals.settings.site_name || 'أوتر',
    breakingNews,
    sliderItems,
    categoryNews,
    categories: cats,
    latestNews,
    featuredNews,
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

// Article page
router.get('/news/:id', (req, res) => {
  const db = getDb();
  const article = db.prepare(`SELECT n.*, c.name_ar as category_name, c.id as cat_id FROM news n LEFT JOIN categories c ON n.category_id = c.id WHERE n.id = ? AND n.status = 1`).get(req.params.id);
  if (!article) return res.status(404).render('404', { title: 'الصفحة غير موجودة' });

  // Increment views
  db.prepare('UPDATE news SET views = views + 1 WHERE id = ?').run(req.params.id);
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
  const siteName = res.locals.settings.site_name || 'أوتر';
  const feed = new RSS({
    title: siteName,
    description: res.locals.settings.site_description || 'أوتر - المصدر الأول للأخبار',
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
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  // Homepage
  xml += `  <url><loc>${baseUrl}/</loc><changefreq>always</changefreq><priority>1.0</priority></url>\n`;

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
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const txt = `User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: ${baseUrl}/sitemap.xml\n`;
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
