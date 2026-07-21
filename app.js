const express = require('express');
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

// Initialize database
initDatabase();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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
    res.locals.breakingNews = db.prepare("SELECT * FROM breaking_news WHERE is_active = 1 ORDER BY sort_order").all();
  } catch (e) {
    res.locals.breakingNews = [];
  }

  next();
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

// Routes
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const featuresRoutes = require('./routes/features');
const apiRoutes = require('./routes/api');

app.use('/', publicRoutes);
app.use('/admin', adminRoutes);
app.use('/api', featuresRoutes);
app.use('/api/v1', apiRoutes);

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
