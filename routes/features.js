const express = require('express');
const router = express.Router();
const { getDb } = require('../db/init');

// ============================================
// COMMENTS
// ============================================

// Add comment (public)
router.post('/comments/add', (req, res) => {
  const db = getDb();
  const { news_id, author_name, author_email, content } = req.body;

  if (!news_id || !author_name || !content) {
    return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
  }

  // Rate limiting: max 5 comments per IP per hour
  const ip = req.ip || req.connection.remoteAddress;
  const recentComments = db.prepare(
    "SELECT COUNT(*) as cnt FROM comments WHERE ip_address = ? AND created_at > datetime('now', '-1 hour')"
  ).get(ip).cnt;

  if (recentComments >= 5) {
    return res.status(429).json({ success: false, message: 'لقد تجاوزت الحد المسموح للتعليقات، حاول لاحقاً' });
  }

  try {
    db.prepare(
      'INSERT INTO comments (news_id, author_name, author_email, content, status, ip_address) VALUES (?, ?, ?, ?, 0, ?)'
    ).run(news_id, author_name, author_email || null, content, ip);

    res.json({ success: true, message: 'تم إضافة التعليق وسيظهر بعد المراجعة' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ' });
  }
});

// Get comments for an article (public - approved only)
router.get('/comments/:newsId', (req, res) => {
  const db = getDb();
  const comments = db.prepare(
    "SELECT * FROM comments WHERE news_id = ? AND status = 1 ORDER BY created_at DESC"
  ).all(req.params.newsId);

  res.json({ success: true, comments });
});

// ============================================
// POLLS
// ============================================

// Get active poll (public)
router.get('/polls/active', (req, res) => {
  const db = getDb();
  const poll = db.prepare(
    "SELECT * FROM polls WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1"
  ).get();

  if (!poll) {
    return res.json({ success: true, poll: null });
  }

  const options = db.prepare(
    "SELECT * FROM poll_options WHERE poll_id = ? ORDER BY id"
  ).all(poll.id);

  const totalVotes = db.prepare(
    "SELECT SUM(votes) as total FROM poll_options WHERE poll_id = ?"
  ).get(poll.id).total || 0;

  // Check if user already voted
  const ip = req.ip || req.connection.remoteAddress;
  const voted = db.prepare(
    "SELECT * FROM poll_votes WHERE poll_id = ? AND ip_address = ?"
  ).get(poll.id, ip);

  res.json({
    success: true,
    poll: { ...poll, options, totalVotes, hasVoted: !!voted }
  });
});

// Vote on poll (public)
router.post('/polls/vote', (req, res) => {
  const db = getDb();
  const { poll_id, option_id } = req.body;
  const ip = req.ip || req.connection.remoteAddress;

  if (!poll_id || !option_id) {
    return res.status(400).json({ success: false, message: 'بيانات غير صحيحة' });
  }

  // Check if already voted
  const existing = db.prepare(
    "SELECT * FROM poll_votes WHERE poll_id = ? AND ip_address = ?"
  ).get(poll_id, ip);

  if (existing) {
    return res.status(400).json({ success: false, message: 'لقد صوتت بالفعل!' });
  }

  try {
    // Record vote
    db.prepare(
      'INSERT INTO poll_votes (poll_id, option_id, ip_address) VALUES (?, ?, ?)'
    ).run(poll_id, option_id, ip);

    // Increment vote count
    db.prepare(
      'UPDATE poll_options SET votes = votes + 1 WHERE id = ?'
    ).run(option_id);

    // Get updated results
    const options = db.prepare(
      "SELECT * FROM poll_options WHERE poll_id = ? ORDER BY id"
    ).all(poll_id);

    const totalVotes = db.prepare(
      "SELECT SUM(votes) as total FROM poll_options WHERE poll_id = ?"
    ).get(poll_id).total || 0;

    res.json({ success: true, message: 'شكراً لتصويتك!', options, totalVotes });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ' });
  }
});

// Get all polls (admin)
router.get('/polls/all', (req, res) => {
  const db = getDb();
  const polls = db.prepare(
    "SELECT *, (SELECT SUM(votes) FROM poll_options WHERE poll_id = polls.id) as total_votes FROM polls ORDER BY created_at DESC"
  ).all();

  res.json({ success: true, polls });
});

// ============================================
// NEWSLETTER
// ============================================

// Subscribe to newsletter (public)
router.post('/newsletter/subscribe', (req, res) => {
  const db = getDb();
  const { email, name } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: 'البريد الإلكتروني مطلوب' });
  }

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, message: 'البريد الإلكتروني غير صحيح' });
  }

  try {
    // Check if already subscribed
    const existing = db.prepare(
      "SELECT * FROM newsletter_subscribers WHERE email = ?"
    ).get(email);

    if (existing) {
      if (existing.is_active) {
        return res.json({ success: true, message: 'أنت مشترك بالفعل!' });
      } else {
        // Re-activate
        db.prepare(
          "UPDATE newsletter_subscribers SET is_active = 1, unsubscribed_at = NULL WHERE email = ?"
        ).run(email);
        return res.json({ success: true, message: 'تم إعادة تفعيل اشتراكك!' });
      }
    }

    db.prepare(
      'INSERT INTO newsletter_subscribers (email, name, is_active) VALUES (?, ?, 1)'
    ).run(email, name || null);

    res.json({ success: true, message: 'تم الاشتراك بنجاح!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ' });
  }
});

// Unsubscribe from newsletter (public)
router.get('/newsletter/unsubscribe', (req, res) => {
  const db = getDb();
  const { email } = req.query;

  if (!email) {
    return res.status(400).send('البريد الإلكتروني مطلوب');
  }

  db.prepare(
    "UPDATE newsletter_subscribers SET is_active = 0, unsubscribed_at = CURRENT_TIMESTAMP WHERE email = ?"
  ).run(email);

  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head><meta charset="UTF-8"><title>إلغاء الاشتراك</title>
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap" rel="stylesheet">
    <style>body{font-family:'Tajawal',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0f2f5;}
    .box{background:#fff;padding:40px;border-radius:12px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,0.1);}
    h2{color:#1a237e;}p{color:#555;}</style></head>
    <body><div class="box"><h2>تم إلغاء الاشتراك</h2><p>تم إلغاء اشتراكك بنجاح.</p><a href="/">العودة للموقع</a></div></body></html>
  `);
});

// Get subscribers (admin)
router.get('/newsletter/subscribers', (req, res) => {
  const db = getDb();
  const subscribers = db.prepare(
    "SELECT * FROM newsletter_subscribers ORDER BY created_at DESC"
  ).all();

  const stats = {
    total: db.prepare('SELECT COUNT(*) as c FROM newsletter_subscribers').get().c,
    active: db.prepare('SELECT COUNT(*) as c FROM newsletter_subscribers WHERE is_active = 1').get().c,
    inactive: db.prepare('SELECT COUNT(*) as c FROM newsletter_subscribers WHERE is_active = 0').get().c
  };

  res.json({ success: true, subscribers, stats });
});

// Send newsletter campaign (admin)
router.post('/newsletter/send', (req, res) => {
  const db = getDb();
  const { subject, content } = req.body;

  if (!subject || !content) {
    return res.status(400).json({ success: false, message: 'الموضوع والمحتوى مطلوبان' });
  }

  try {
    const subscribers = db.prepare(
      "SELECT * FROM newsletter_subscribers WHERE is_active = 1"
    ).all();

    // Create campaign record
    db.prepare(
      'INSERT INTO newsletter_campaigns (subject, content, sent_at, recipients_count, status) VALUES (?, ?, CURRENT_TIMESTAMP, ?, 1)'
    ).run(subject, content, subscribers.length);

    // In production, this would send actual emails via nodemailer
    // For now, we just log it
    console.log(`Newsletter campaign "${subject}" sent to ${subscribers.length} subscribers`);

    res.json({
      success: true,
      message: `تم إرسال النشرة البريدية إلى ${subscribers.length} مشترك`,
      recipients: subscribers.length
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ' });
  }
});

module.exports = router;
