const crypto = require('crypto');

const BOT_PATTERN = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|twitterbot|headless|uptimerobot|pingdom/i;

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return String(forwarded || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function deviceType(userAgent) {
  const ua = String(userAgent || '');
  if (/bot|crawler|spider/i.test(ua)) return 'bot';
  if (/tablet|ipad|android(?!.*mobile)/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android/i.test(ua)) return 'mobile';
  return 'desktop';
}

function visitorHash(req) {
  const secret = process.env.SESSION_SECRET || 'awtar-analytics';
  const input = [clientIp(req), req.headers['user-agent'] || '', req.headers['accept-language'] || ''].join('|');
  return crypto.createHmac('sha256', secret).update(input).digest('hex');
}

function recordArticleView(db, req, articleId) {
  const ua = String(req.headers['user-agent'] || '');
  if (BOT_PATTERN.test(ua)) return { counted: false, reason: 'bot' };
  const hash = visitorHash(req);
  const recent = db.prepare(`
    SELECT id FROM article_view_events
    WHERE news_id = ? AND visitor_hash = ? AND viewed_at > CURRENT_TIMESTAMP - INTERVAL '30 minutes'
    LIMIT 1
  `).get(articleId, hash);
  if (recent) return { counted: false, reason: 'duplicate' };
  db.prepare(`
    INSERT INTO article_view_events (news_id, visitor_hash, device_type, referrer, user_agent)
    VALUES (?, ?, ?, ?, ?)
  `).run(articleId, hash, deviceType(ua), String(req.headers.referer || req.headers.referrer || '').slice(0, 1000), ua.slice(0, 500));
  db.prepare('UPDATE news SET views = COALESCE(views, 0) + 1 WHERE id = ?').run(articleId);
  return { counted: true, reason: 'new' };
}

function buildDailySeries(db, days = 30) {
  const rows = db.prepare(`
    SELECT DATE(viewed_at) AS day, COUNT(*)::int AS views, COUNT(DISTINCT visitor_hash)::int AS visitors
    FROM article_view_events
    WHERE viewed_at >= CURRENT_DATE - INTERVAL '${Math.max(1, Math.min(90, Number(days) || 30)) - 1} days'
    GROUP BY DATE(viewed_at)
    ORDER BY day ASC
  `).all();
  const byDay = new Map(rows.map(row => [String(row.day).slice(0, 10), row]));
  const result = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - i);
    const key = date.toISOString().slice(0, 10);
    const row = byDay.get(key);
    result.push({ day: key, views: Number(row?.views || 0), visitors: Number(row?.visitors || 0) });
  }
  return result;
}

function getAnalytics(db) {
  const period = db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE viewed_at >= CURRENT_DATE)::int AS today,
      COUNT(*) FILTER (WHERE viewed_at >= CURRENT_DATE - INTERVAL '6 days')::int AS week,
      COUNT(*) FILTER (WHERE viewed_at >= DATE_TRUNC('month', CURRENT_DATE))::int AS month,
      COUNT(DISTINCT visitor_hash) FILTER (WHERE viewed_at >= CURRENT_DATE)::int AS unique_today,
      COUNT(DISTINCT visitor_hash) FILTER (WHERE viewed_at >= CURRENT_DATE - INTERVAL '6 days')::int AS unique_week,
      COUNT(DISTINCT visitor_hash) FILTER (WHERE viewed_at >= DATE_TRUNC('month', CURRENT_DATE))::int AS unique_month
    FROM article_view_events
  `).get();
  const topStories = db.prepare(`
    SELECT n.id, n.title, n.views, COUNT(e.id)::int AS period_views
    FROM article_view_events e JOIN news n ON n.id = e.news_id
    WHERE e.viewed_at >= CURRENT_DATE - INTERVAL '29 days'
    GROUP BY n.id, n.title, n.views
    ORDER BY period_views DESC, n.views DESC
    LIMIT 10
  `).all();
  const devices = db.prepare(`
    SELECT device_type AS device, COUNT(*)::int AS views
    FROM article_view_events WHERE viewed_at >= CURRENT_DATE - INTERVAL '29 days'
    GROUP BY device_type ORDER BY views DESC
  `).all();
  const referrers = db.prepare(`
    SELECT CASE WHEN referrer IS NULL OR referrer = '' THEN 'مباشر' ELSE split_part(regexp_replace(referrer, '^https?://', ''), '/', 1) END AS source, COUNT(*)::int AS views
    FROM article_view_events WHERE viewed_at >= CURRENT_DATE - INTERVAL '29 days'
    GROUP BY source ORDER BY views DESC LIMIT 8
  `).all();
  return { period, daily: buildDailySeries(db, 30), topStories, devices, referrers };
}

module.exports = { recordArticleView, getAnalytics, deviceType };
