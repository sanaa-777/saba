const express = require('express');
const compression = require('compression');
const cookieSession = require('cookie-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const http = require('http');
const { initDatabase, getDb } = require('./db/init');
const { languageMiddleware } = require('./middleware/language');

const app = express();
const server = http.createServer(app);

// Socket.IO - optional, skip on Vercel
let io = { emit: () => {}, on: () => {} };
try {
  if (!process.env.VERCEL) {
    const { Server } = require('socket.io');
    io = new Server(server);
  }
} catch (e) { /* Socket.IO not available */ }

const PORT = process.env.PORT || 3000;
const isVercel = !!process.env.VERCEL;

// Initialize database (with error handling for Vercel)
try {
  initDatabase();
} catch (err) {
  console.error('Database initialization failed:', err.message);
}

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Compression for faster loading on slow connections
app.use(compression({ threshold: 1024, level: 6 }));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.use(cookieSession({
  name: 'awtar_session',
  keys: [process.env.SESSION_SECRET || 'awtar-secret-key-2024'],
  maxAge: 24 * 60 * 60 * 1000,
  sameSite: 'lax',
  httpOnly: false,
  secure: false
}));

// Language middleware
app.use(languageMiddleware);

// Global middleware
app.use((req, res, next) => {
  try {
  const db = getDb();
  res.locals.categories = db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order').all();
  res.locals.settings = {};
  const settings = db.prepare('SELECT * FROM settings').all();
  settings.forEach(s => { res.locals.settings[s.key] = s.value; });
  res.locals.currentPath = req.path;
  res.locals.session = req.session;

  try {
    res.locals.activePoll = db.prepare("SELECT * FROM polls WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1").get();
    if (res.locals.activePoll) {
      res.locals.activePollOptions = db.prepare("SELECT * FROM poll_options WHERE poll_id = ? ORDER BY id").all(res.locals.activePoll.id);
      const totalVotes = db.prepare("SELECT SUM(votes) as total FROM poll_options WHERE poll_id = ?").get(res.locals.activePoll.id).total || 0;
      res.locals.activePollTotalVotes = totalVotes;
    }
  } catch (e) {
    res.locals.activePoll = null;
  }

  try {
    // Get manual breaking news
    const manualBreaking = db.prepare("SELECT id, text, link, sort_order, created_at FROM breaking_news WHERE is_active = 1").all();
    // Get auto عاجl news from category
    let autoBreaking = [];
    try {
      // Step 1: Find عاجl category
      const urgentCat = db.prepare("SELECT id FROM categories WHERE slug = 'breaking' LIMIT 1").get();
      if (urgentCat) {
        // Step 2: Get news from that category
        const catId = Number(urgentCat.id) || 16;
        const news = db.prepare("SELECT id, title, published_at FROM news WHERE category_id = " + catId + " AND status = 1 ORDER BY published_at DESC LIMIT 10").all();
        autoBreaking = news.map(n => ({
          id: n.id,
          text: n.title,
          link: '/news/' + n.id,
          sort_order: 999,
          created_at: n.published_at
        }));
      }
    } catch(e) {}
    // Combine and deduplicate, limit to 10
    const allBreaking = [...manualBreaking, ...autoBreaking];
    const seen = new Set();
    res.locals.breakingNews = allBreaking.filter(item => {
      if (seen.has(item.text)) return false;
      seen.add(item.text);
      return true;
    }).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).slice(0, 10);
  } catch (e) {
    res.locals.breakingNews = [];
  }

  next();
  } catch (err) {
    console.error('Global middleware error:', err.message);
    // Set defaults so views don't crash
    res.locals.categories = res.locals.categories || [];
    res.locals.settings = res.locals.settings || {};
    res.locals.currentPath = req.path;
    res.locals.session = req.session;
    res.locals.activePoll = null;
    res.locals.breakingNews = [];
    next();
  }
});

// Socket.IO handler
if (!isVercel) {
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
}

app.set('io', io);

// Caching strategy: static = long cache, dynamic = no cache
app.use((req, res, next) => {
  const staticPrefixes = ['/css/', '/js/', '/images/', '/manifest.json', '/favicon', '/robots.txt'];
  const isStatic = staticPrefixes.some(prefix => req.path.startsWith(prefix));
  if (isStatic) {
    res.set('Cache-Control', 'public, max-age=604800, immutable');
  } else {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
  }
  next();
});

// Routes
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const featuresRoutes = require('./routes/features');
const apiRoutes = require('./routes/api');

app.use('/', publicRoutes);
app.use('/admin', adminRoutes);
app.use('/api', featuresRoutes);
app.use('/api/v1', apiRoutes);

// Image serving endpoint (from database)
app.get('/api/images/:id', (req, res) => {
  const db = getDb();
  const img = db.prepare('SELECT data, mime_type, filename FROM images WHERE id = ?').get(req.params.id);
  if (!img) return res.status(404).send('Image not found');
  const buffer = Buffer.from(img.data, 'base64');
  res.set('Content-Type', img.mime_type);
  res.set('Content-Disposition', `inline; filename="${img.filename}"`);
  res.set('Cache-Control', 'public, max-age=31536000');
  res.send(buffer);
});

// Image proxy for blocked sources
app.get('/api/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).send('Missing url parameter');
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*,*/*',
        'Referer': new URL(imageUrl).origin + '/'
      }
    });
    clearTimeout(timeout);
    if (!response.ok) return res.status(response.status).send('Image not available');
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    res.status(500).send('Proxy error');
  }
});

// API endpoints
app.get('/api/breaking-news', (req, res) => {
  const db = getDb();
  const breaking = db.prepare("SELECT * FROM breaking_news WHERE is_active = 1 ORDER BY sort_order").all();
  res.json({ success: true, breaking });
});

app.get('/api/new-news-count', (req, res) => {
  const db = getDb();
  const since = req.query.since || new Date(Date.now() - 3600000).toISOString();
  const count = db.prepare(
    "SELECT COUNT(*) as cnt FROM news WHERE status = 1 AND published_at > ?"
  ).get(since).cnt;
  res.json({ count });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('404', { title: res.locals.t ? res.locals.t('page_not_found') : 'الصفحة غير موجودة' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', {
    title: 'خطأ في الخادم',
    error: process.env.NODE_ENV === 'production' ? 'حدث خطأ غير متوقع' : err.message
  });
});

function broadcastBreakingNews(data) {
  io.emit('breaking-news', data);
}

// Start server (local only)
if (!isVercel) {
  server.listen(PORT, () => {
    console.log(`Awtar running on http://localhost:${PORT}`);
  });
}

module.exports = app;
