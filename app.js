const express = require('express');
const session = require('express-session');
const path = require('path');
const { initDatabase, getDb } = require('./db/init');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
initDatabase();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'saba-news-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Global middleware - make categories and settings available to all views
app.use((req, res, next) => {
  const db = getDb();
  res.locals.categories = db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order').all();
  res.locals.settings = {};
  const settings = db.prepare('SELECT * FROM settings').all();
  settings.forEach(s => { res.locals.settings[s.key] = s.value; });
  res.locals.currentPath = req.path;
  res.locals.session = req.session;
  next();
});

// Routes
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

app.use('/', publicRoutes);
app.use('/admin', adminRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).render('404', { title: 'الصفحة غير موجودة' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { title: 'خطأ في الخادم', error: err.message });
});

app.listen(PORT, () => {
  console.log(`SABA News running on http://localhost:${PORT}`);
});

module.exports = app;
