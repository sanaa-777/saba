const { initDatabase } = require('./db/init');
const fs = require('fs');
const path = require('path');

// Ensure upload directories exist
const dirs = [
  path.join(__dirname, 'public/images/uploads'),
  path.join(__dirname, 'public/images'),
  path.join(__dirname, 'public/css'),
  path.join(__dirname, 'public/js')
];
dirs.forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); });

// Initialize database with seed data
initDatabase();
console.log('Database initialized.');

// Start server
require('./app');
