const RSSParser = require('rss-parser');
const cheerio = require('cheerio');

// Strong proxy list for blocked sources
const PROXY_SERVICES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?',
  'https://api.codetabs.com/v1/proxy?quest='
];

function getProxy(index = 0) {
  return PROXY_SERVICES[index % PROXY_SERVICES.length];
}

const rssParser = new RSSParser({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ar,en;q=0.5'
  }
});

// ─── Source Type Detection ───
function detectSourceType(url) {
  const u = url.toLowerCase();
  if (u.includes('t.me/') || u.includes('telegram.me/')) return 'telegram';
  if (u.endsWith('.xml') || u.endsWith('.rss') || u.endsWith('.atom') || u.includes('/rss') || u.includes('/feed') || u.includes('/atom') || u.includes('feeds.') || u.includes('rss.')) return 'rss';
  return 'website';
}

// ─── Fetch with timeout, retry & proxy fallback ───
async function fetchWithRetry(url, opts = {}, retries = 2) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeout || 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ar,en;q=0.5',
        ...opts.headers
      },
      redirect: 'follow'
    });
    clearTimeout(timeout);
    if (!res.ok && retries > 0) {
      // Try with proxy on 403/429
      if (res.status === 403 || res.status === 429) {
        const proxyUrl = getProxy(retries) + encodeURIComponent(url);
        return fetchWithRetry(proxyUrl, opts, retries - 1);
      }
    }
    return res;
  } catch (err) {
    clearTimeout(timeout);
    if (retries > 0) {
      // Try with proxy on network error
      const proxyUrl = getProxy(retries) + encodeURIComponent(url);
      return fetchWithRetry(proxyUrl, opts, retries - 1);
    }
    throw err;
  }
}

// ─── RSS/Atom Fetcher ───
async function fetchRSS(url, proxyUrl) {
  const targetUrl = proxyUrl ? `${proxyUrl}${encodeURIComponent(url)}` : url;
  const feed = await rssParser.parseURL(targetUrl);
  return (feed.items || []).map(item => ({
    title: cleanText(item.title || ''),
    content: item['content:encoded'] || item.content || item.contentSnippet || item.description || '',
    summary: cleanText(item.contentSnippet || item.description || '').substring(0, 500),
    url: item.link || '',
    image: extractImageFromContent(item['content:encoded'] || item.content || '') || extractImageFromContent(item.description || '') || null,
    author: item.creator || item.author || feed.title || '',
    published_at: item.isoDate || item.pubDate || new Date().toISOString(),
    source_name: feed.title || ''
  }));
}

// ─── Website Scraper ───
async function fetchWebsite(url, proxyUrl) {
  const targetUrl = proxyUrl ? `${proxyUrl}${encodeURIComponent(url)}` : url;
  const res = await fetchWithRetry(targetUrl);
  const html = await res.text();
  const $ = cheerio.load(html);
  const articles = [];

  // Try RSS/Atom link discovery first
  const rssLink = $('link[type="application/rss+xml"], link[type="application/atom+xml"]').first().attr('href');
  if (rssLink) {
    try {
      const fullRssUrl = rssLink.startsWith('http') ? rssLink : new URL(rssLink, url).href;
      return await fetchRSS(fullRssUrl, proxyUrl);
    } catch (e) { /* fall through to scraping */ }
  }

  // Common article selectors
  const selectors = [
    'article', '.article', '.post', '.news-item', '.story',
    '.news-card', '.card', '.item', '.entry', '.list-item',
    '[class*="article"]', '[class*="news"]', '[class*="story"]',
    '.node--type-article', '.view-content .views-row'
  ];

  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const $el = $(el);
      const titleEl = $el.find('h1, h2, h3, h4, .title, [class*="title"]').first();
      const title = cleanText(titleEl.text());
      if (!title || title.length < 10) return;

      const linkEl = $el.find('a[href]').first().add(titleEl.find('a[href]').first()).first();
      let link = linkEl.attr('href') || '';
      if (link && !link.startsWith('http')) link = new URL(link, url).href;

      const imgEl = $el.find('img').first();
      let img = imgEl.attr('data-src') || imgEl.attr('src') || '';
      if (img && !img.startsWith('http') && img.startsWith('/')) img = new URL(img, url).href;

      const summaryEl = $el.find('p, .summary, .excerpt, .description, [class*="desc"]').first();
      const summary = cleanText(summaryEl.text()).substring(0, 500);

      const dateEl = $el.find('time, .date, .time, [class*="date"], [class*="time"]').first();
      const dateStr = dateEl.attr('datetime') || dateEl.text() || '';

      if (link && !articles.find(a => a.url === link)) {
        articles.push({
          title,
          content: summary,
          summary,
          url: link,
          image: img || null,
          author: '',
          published_at: dateStr ? parseArabicDate(dateStr) : new Date().toISOString(),
          source_name: ''
        });
      }
    });
    if (articles.length >= 5) break;
  }

  // Fallback: og:article links
  if (articles.length === 0) {
    $('a[href]').each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href') || '';
      const text = cleanText($a.text());
      if (text.length > 20 && href && (href.includes('/news/') || href.includes('/article/') || href.includes('/post/'))) {
        const fullUrl = href.startsWith('http') ? href : new URL(href, url).href;
        if (!articles.find(a => a.url === fullUrl)) {
          articles.push({
            title: text,
            content: '',
            summary: '',
            url: fullUrl,
            image: null,
            author: '',
            published_at: new Date().toISOString(),
            source_name: ''
          });
        }
      }
    });
  }

  return articles.slice(0, 30);
}

// ─── Telegram Fetcher ───
async function fetchTelegram(url) {
  const channelMatch = url.match(/t\.me\/(?:s\/)?([a-zA-Z0-9_]+)/);
  if (!channelMatch) throw new Error('Invalid Telegram URL');
  const channel = channelMatch[1];
  const tUrl = `https://t.me/s/${channel}`;

  const res = await fetchWithRetry(tUrl);
  const html = await res.text();
  const $ = cheerio.load(html);
  const articles = [];

  $('.tgme_widget_message_wrap, .tgme_widget_message').each((_, el) => {
    const $msg = $(el);
    const textEl = $msg.find('.tgme_widget_message_text');
    const text = cleanText(textEl.text());
    if (!text || text.length < 20) return;

    const dateEl = $msg.find('time, .tgme_widget_message_date time');
    const dateStr = dateEl.attr('datetime') || '';
    const msgLink = $msg.find('.tgme_widget_message_date a').attr('href') || `https://t.me/${channel}`;

    // Extract images
    const imgEl = $msg.find('.tgme_widget_message_photo_wrap, img');
    let img = null;
    const bgStyle = imgEl.attr('style') || '';
    const bgMatch = bgStyle.match(/url\(['"]?(.*?)['"]?\)/);
    if (bgMatch) img = bgMatch[1];
    else img = imgEl.attr('src') || null;

    // Use first line as title
    const firstLine = text.split('\n')[0].substring(0, 150);

    articles.push({
      title: firstLine,
      content: text,
      summary: text.substring(0, 300),
      url: msgLink,
      image: img,
      author: `@${channel}`,
      published_at: dateStr || new Date().toISOString(),
      source_name: `Telegram: ${channel}`
    });
  });

  return articles.slice(0, 30);
}

// ─── Article Detail Fetcher ───
async function fetchArticleDetail(url, proxyUrl) {
  try {
    const targetUrl = proxyUrl ? `${proxyUrl}${encodeURIComponent(url)}` : url;
    const res = await fetchWithRetry(targetUrl, { timeout: 10000 });
    const html = await res.text();
    const $ = cheerio.load(html);

    // OpenGraph
    const ogImage = $('meta[property="og:image"]').attr('content') || null;
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const ogDesc = $('meta[property="og:description"]').attr('content') || '';

    // JSON-LD
    let jsonLd = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html());
        if (data['@type'] === 'NewsArticle' || data['@type'] === 'Article') {
          jsonLd = data;
        }
      } catch (e) {}
    });

    // Main content extraction
    const contentSelectors = [
      'article', '.article-body', '.article-content', '.post-content',
      '.entry-content', '.story-body', '.news-content', '.content-area',
      'main .content', '.article-text', '[class*="article"][class*="content"]'
    ];
    let content = '';
    for (const sel of contentSelectors) {
      const el = $(sel).first();
      if (el.length && el.text().trim().length > 100) {
        el.find('script, style, nav, header, footer, .ads, .sidebar, .related, .comments').remove();
        content = el.html() || '';
        break;
      }
    }

    // Author
    const author = (jsonLd && jsonLd.author) ?
      (typeof jsonLd.author === 'string' ? jsonLd.author : jsonLd.author.name || '') :
      $('meta[name="author"]').attr('content') || '';

    // Date
    const datePublished = (jsonLd && jsonLd.datePublished) ||
      $('meta[property="article:published_time"]').attr('content') ||
      $('time').first().attr('datetime') || '';

    // Image
    const image = (jsonLd && jsonLd.image) ?
      (typeof jsonLd.image === 'string' ? jsonLd.image : Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image.url) :
      ogImage || $('article img, .article img, .content img').first().attr('src') || null;

    return {
      title: ogTitle || (jsonLd && jsonLd.headline) || '',
      content: content || ogDesc || '',
      summary: ogDesc || (jsonLd && jsonLd.description) || '',
      image,
      author,
      published_at: datePublished || new Date().toISOString()
    };
  } catch (err) {
    return null;
  }
}

// ─── Main Fetch Dispatcher ───
async function fetchFromSource(source) {
  const { url, source_type, use_proxy, proxy_url } = source;
  const proxyUrl = use_proxy && proxy_url ? proxy_url : null;
  const detectedType = source_type === 'auto' ? detectSourceType(url) : source_type;

  switch (detectedType) {
    case 'rss':
      return fetchRSS(url, proxyUrl);
    case 'telegram':
      return fetchTelegram(url);
    case 'website':
      return fetchWebsite(url, proxyUrl);
    default:
      return fetchWebsite(url, proxyUrl);
  }
}

// ─── Deduplication ───
function isDuplicate(article, db) {
  // Check by URL
  if (article.url) {
    const existing = db.prepare('SELECT id FROM news WHERE content LIKE ? OR title = ?').get(`%${article.url}%`, article.title);
    if (existing) return true;
  }
  // Check by exact title
  const byTitle = db.prepare('SELECT id FROM news WHERE title = ?').get(article.title);
  if (byTitle) return true;

  // Check by similar title (first 50 chars)
  if (article.title.length > 20) {
    const partial = article.title.substring(0, 50);
    const similar = db.prepare('SELECT id FROM news WHERE title LIKE ?').get(`%${partial}%`);
    if (similar) return true;
  }

  return false;
}

// ─── Save Article ───
function saveArticle(article, source, db) {
  const categoryId = source.category_id || null;
  const status = source.auto_publish ? 1 : 0;
  const slug = article.title.trim().replace(/\s+/g, '-').substring(0, 80);
  const publishedAt = article.published_at ? new Date(article.published_at).toISOString().slice(0, 19).replace('T', ' ') : new Date().toISOString().slice(0, 19).replace('T', ' ');
  const imageField = article.image || null;

  // Enrich with detail page if we have a URL and no content
  const content = article.content || article.summary || '';
  const summary = article.summary || (article.content ? article.content.substring(0, 300) : '');

  const result = db.prepare(`INSERT INTO news (title, summary, content, image, category_id, source, is_breaking, is_slider, is_featured, status, published_at, created_at, updated_at, slug) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)`).run(
    article.title.substring(0, 500),
    summary.substring(0, 1000),
    content,
    imageField,
    categoryId,
    article.source_name || source.name,
    status,
    publishedAt,
    slug
  );
  return result.lastInsertRowid;
}

// ─── Full Fetch Pipeline for One Source ───
async function fetchAndSave(db, sourceId) {
  const source = db.prepare('SELECT * FROM news_sources WHERE id = ?').get(sourceId);
  if (!source) throw new Error('Source not found');

  // Create log entry
  const logResult = db.prepare('INSERT INTO fetch_logs (source_id, status) VALUES (?, ?)').run(sourceId, 'running');
  const logId = logResult.lastInsertRowid;

  let newCount = 0;
  let dupCount = 0;
  let error = null;
  let details = '';

  try {
    const articles = await fetchFromSource(source);
    details = `Found ${articles.length} articles from ${source.source_type}`;

    for (const article of articles) {
      if (!article.title || article.title.length < 5) continue;

      if (isDuplicate(article, db)) {
        dupCount++;
        continue;
      }

      try {
        // Try to enrich with detail page for website sources
        if (article.url && source.source_type === 'website' && (!article.content || article.content.length < 100)) {
          const detail = await fetchArticleDetail(article.url, source.use_proxy && source.proxy_url ? source.proxy_url : null);
          if (detail) {
            article.content = detail.content || article.content;
            article.image = article.image || detail.image;
            article.author = article.author || detail.author;
            if (detail.published_at) article.published_at = detail.published_at;
          }
        }

        saveArticle(article, source, db);
        newCount++;
      } catch (saveErr) {
        details += `\nSave error for "${article.title}": ${saveErr.message}`;
      }
    }

    // Update source stats
    db.prepare(`UPDATE news_sources SET
      last_fetched_at = CURRENT_TIMESTAMP,
      next_fetch_at = CURRENT_TIMESTAMP + INTERVAL '1 second' * ?,
      last_fetch_status = 'success',
      last_error = NULL,
      total_fetched = total_fetched + ?,
      total_duplicates = total_duplicates + ?,
      last_new_count = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`).run(source.fetch_interval, newCount, dupCount, newCount, sourceId);

    // Update log
    db.prepare(`UPDATE fetch_logs SET
      finished_at = CURRENT_TIMESTAMP,
      status = 'success',
      new_count = ?,
      duplicate_count = ?,
      details = ?
    WHERE id = ?`).run(newCount, dupCount, details, logId);

  } catch (err) {
    error = err.message || 'Unknown error';
    details += `\nError: ${error}`;

    db.prepare(`UPDATE news_sources SET
      last_fetched_at = CURRENT_TIMESTAMP,
      next_fetch_at = CURRENT_TIMESTAMP + INTERVAL '1 second' * ?,
      last_fetch_status = 'error',
      last_error = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`).run(source.fetch_interval, error, sourceId);

    db.prepare(`UPDATE fetch_logs SET
      finished_at = CURRENT_TIMESTAMP,
      status = 'error',
      error_message = ?,
      details = ?
    WHERE id = ?`).run(error, details, logId);
  }

  return { newCount, dupCount, error, details };
}

// ─── Fetch All Active Sources ───
async function fetchAllActive(db) {
  const sources = db.prepare('SELECT * FROM news_sources WHERE is_active = 1').all();
  const results = [];
  for (const source of sources) {
    try {
      const result = await fetchAndSave(db, source.id);
      results.push({ sourceId: source.id, name: source.name, ...result });
    } catch (err) {
      results.push({ sourceId: source.id, name: source.name, error: err.message });
    }
  }
  return results;
}

// ─── Helpers ───
function cleanText(text) {
  return (text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function extractImageFromContent(html) {
  if (!html) return null;
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function parseArabicDate(str) {
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch (e) {}
  return new Date().toISOString();
}

module.exports = {
  detectSourceType,
  fetchFromSource,
  fetchAndSave,
  fetchAllActive,
  fetchRSS,
  fetchWebsite,
  fetchTelegram,
  fetchArticleDetail,
  isDuplicate,
  saveArticle
};
