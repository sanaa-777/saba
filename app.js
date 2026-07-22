const express = require('express');
const compression = require('compression');
const cookieSession = require('cookie-session');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const path = require('path');
const http = require('http');
const { initDatabase, getDb } = require('./db/init');
const { languageMiddleware } = require('./middleware/language');
const rateLimit = require('express-rate-limit');

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
  keys: [process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')],
  maxAge: 24 * 60 * 60 * 1000,
  sameSite: 'strict',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production'
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
      // Auto-sync: add recent urgent news to breaking_news if not already there
      let autoBreaking = [];
      try {
        const urgentCat = (res.locals.categories || []).find(c => c.slug === 'breaking');
        if (urgentCat) {
          const recentUrgent = db.prepare('SELECT id, title FROM news WHERE category_id = ? AND status = 1 ORDER BY published_at DESC LIMIT 10').all(urgentCat.id);
          for (const n of recentUrgent) {
            const exists = db.prepare('SELECT id FROM breaking_news WHERE link = ?').get('/news/' + n.id);
            if (!exists) {
              db.prepare('INSERT INTO breaking_news (text, link, is_active, sort_order) VALUES (?, ?, 1, 999)').run(n.title, '/news/' + n.id);
            }
          }
        }
        // Re-fetch all active breaking news after auto-sync
        autoBreaking = db.prepare("SELECT id, text, link, sort_order, created_at FROM breaking_news WHERE is_active = 1").all();
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

// ============================================================
// Image Proxy — SSRF-safe, open to external news image sources
// ============================================================
const BLOCKED_HOSTS = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]',
  '169.254.169.254', 'metadata.google.internal',
  'metadata.google.com', 'instance-data'
]);

function isPrivateIP(hostname) {
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) return false;
  const [, a, b, c] = ipv4Match.map(Number);
  // Block RFC1918 + link-local + loopback
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  return false;
}

function isSafeProxyUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const hostname = parsed.hostname.toLowerCase();
    // Block known bad hosts
    if (BLOCKED_HOSTS.has(hostname)) return false;
    // Block private IPs
    if (isPrivateIP(hostname)) return false;
    // Block internal domains
    if (hostname.endsWith('.internal') || hostname.endsWith('.local') || hostname.endsWith('.localhost')) return false;
    // Block non-standard ports (allow 80, 443, and empty)
    if (parsed.port && !['80', '443', ''].includes(parsed.port)) return false;
    return true;
  } catch (e) {
    return false;
  }
}

// In-memory cache for proxied images (simple LRU with TTL)
const imageCache = new Map();
const IMAGE_CACHE_MAX = 500;
const IMAGE_CACHE_TTL = 3600000; // 1 hour

function getCachedImage(key) {
  const entry = imageCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > IMAGE_CACHE_TTL) {
    imageCache.delete(key);
    return null;
  }
  return entry;
}

function setCachedImage(key, buffer, contentType) {
  if (imageCache.size >= IMAGE_CACHE_MAX) {
    const firstKey = imageCache.keys().next().value;
    imageCache.delete(firstKey);
  }
  imageCache.set(key, { buffer, contentType, ts: Date.now(), size: buffer.length });
}

// Rate limit proxy endpoint
const proxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many proxy requests' },
  standardHeaders: true,
  legacyHeaders: false
});

app.get('/api/proxy-image', proxyLimiter, async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).json({ error: 'Missing url parameter' });
  if (!isSafeProxyUrl(imageUrl)) return res.status(403).json({ error: 'URL not allowed' });

  // Check cache first
  const cacheKey = imageUrl;
  const cached = getCachedImage(cacheKey);
  if (cached) {
    res.set('Content-Type', cached.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-Cache', 'HIT');
    return res.send(cached.buffer);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
        'Referer': new URL(imageUrl).origin + '/'
      }
    });
    clearTimeout(timeout);

    if (!response.ok) return res.status(response.status).send('Image not available');

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    // Validate content type is actually an image
    if (!contentType.startsWith('image/')) return res.status(400).json({ error: 'Not an image' });

    const buffer = Buffer.from(await response.arrayBuffer());
    // Limit max size to 10MB
    if (buffer.length > 10 * 1024 * 1024) return res.status(413).json({ error: 'Image too large' });
    // Skip tiny images (likely tracking pixels)
    if (buffer.length < 100) return res.status(400).json({ error: 'Image too small' });

    // Cache it
    setCachedImage(cacheKey, buffer, contentType);

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-Cache', 'MISS');
    res.send(buffer);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Image fetch timeout' });
    }
    console.error('Proxy error:', imageUrl, err.message);
    res.status(502).json({ error: 'Failed to fetch image' });
  }
});

// Cron endpoint for automatic news fetching (Vercel Cron + GitHub Actions)
app.get('/api/cron/fetch-news', async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // Detect trigger source
  const userAgent = req.headers['user-agent'] || '';
  let triggeredBy = 'vercel_cron';
  if (userAgent.includes('GitHub Actions')) triggeredBy = 'github_actions';
  else if (req.query.source === 'github') triggeredBy = 'github_actions';
  else if (req.query.source === 'supabase') triggeredBy = 'supabase';

  try {
    const db = getDb();
    const { fetchAllActive } = require('./services/news-fetcher');
    const result = await fetchAllActive(db, triggeredBy);

    if (result.skipped) {
      return res.json({ success: true, skipped: true, reason: result.reason });
    }

    res.json({
      success: true,
      triggeredBy,
      totalNew: result.totalNew,
      totalImages: result.totalImages,
      errors: result.errors,
      sources: result.results.length
    });
  } catch (err) {
    console.error('Cron fetch error:', err.message);
    res.status(500).json({ error: err.message });
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
    console.log(`Awtar News running on http://localhost:${PORT}`);
  });
}

module.exports = app;

// Debug endpoint to check sources (temporary)
app.get('/api/debug/sources', (req, res) => {
  try {
    const db = getDb();
    const sources = db.prepare('SELECT id, name, url, is_active, last_fetch_status, last_error FROM news_sources').all();
    res.json({ success: true, sources });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});
