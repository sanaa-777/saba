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
  timeout: 20000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
    'Accept-Language': 'ar,en;q=0.5'
  },
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail'],
      ['media:group', 'mediaGroup'],
      ['enclosure', 'enclosure']
    ]
  }
});

// ─── Source Type Detection ───
function detectSourceType(url) {
  const u = url.toLowerCase();
  if (u.includes('t.me/') || u.includes('telegram.me/')) return 'telegram';
  if (u.endsWith('.xml') || u.endsWith('.rss') || u.endsWith('.atom') || u.includes('/rss') || u.includes('/feed') || u.includes('/atom') || u.includes('feeds.') || u.includes('rss.')) return 'rss';
  return 'website';
}

// ─── Distributed Locking ───
const LOCK_TTL_SECONDS = 300; // 5 minutes max lock duration

function acquireLock(db, lockName, lockedBy) {
  try {
    // Clean expired locks first
    try {
      db.prepare("DELETE FROM fetch_locks WHERE expires_at < CURRENT_TIMESTAMP").run();
    } catch(e) { /* table might not exist */ }

    // Try to acquire lock
    try {
      const existing = db.prepare("SELECT lock_name, locked_by, locked_at, expires_at FROM fetch_locks WHERE lock_name = ? AND expires_at > CURRENT_TIMESTAMP").get(lockName);
      if (existing) {
        return { acquired: false, lockedBy: existing.locked_by, lockedAt: existing.locked_at };
      }
    } catch(e) { /* table might not exist, proceed */ }

    // Delete existing lock if any
    try {
      db.prepare("DELETE FROM fetch_locks WHERE lock_name = ?").run(lockName);
    } catch(e) { /* table might not exist */ }

    // Acquire lock
    try {
      db.prepare("INSERT INTO fetch_locks (lock_name, locked_by, locked_at, expires_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 second' * ?)").run(lockName, lockedBy, LOCK_TTL_SECONDS);
    } catch(e) {
      // Table doesn't exist — proceed without lock
      console.warn('Lock table not available, proceeding without lock');
    }
    return { acquired: true };
  } catch (err) {
    console.warn('Lock acquisition error (proceeding anyway):', err.message);
    return { acquired: true, fallback: true };
  }
}

function releaseLock(db, lockName) {
  try {
    db.prepare("DELETE FROM fetch_locks WHERE lock_name = ?").run(lockName);
  } catch (err) {
    // Table doesn't exist, ignore
  }
}

function isFetchLocked(db) {
  try {
    const lock = db.prepare("SELECT lock_name, locked_by, locked_at FROM fetch_locks WHERE lock_name = 'global_fetch' AND expires_at > CURRENT_TIMESTAMP").get();
    return lock || null;
  } catch (err) {
    return null; // Table doesn't exist, not locked
  }
}

// ─── Smart Retry with Exponential Backoff ───
async function fetchWithRetry(url, opts = {}, retries = 2) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeout || 20000);
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
      if (res.status === 403 || res.status === 429) {
        // Exponential backoff: 1s, 2s, 4s...
        const delay = Math.pow(2, 2 - retries) * 1000;
        await new Promise(r => setTimeout(r, delay));
        const proxyUrl = getProxy(retries) + encodeURIComponent(url);
        return fetchWithRetry(proxyUrl, opts, retries - 1);
      }
    }
    return res;
  } catch (err) {
    clearTimeout(timeout);
    if (retries > 0) {
      // Exponential backoff on network errors
      const delay = Math.pow(2, 2 - retries) * 1000;
      await new Promise(r => setTimeout(r, delay));
      const proxyUrl = getProxy(retries) + encodeURIComponent(url);
      return fetchWithRetry(proxyUrl, opts, retries - 1);
    }
    throw err;
  }
}

// ─── Image Extraction — Multi-stage pipeline ───

function extractImageFromRSSItem(item) {
  if (item.mediaContent) {
    const contents = Array.isArray(item.mediaContent) ? item.mediaContent : [item.mediaContent];
    for (const mc of contents) {
      const url = mc.$ ? mc.$.url : (typeof mc === 'string' ? mc : null);
      if (url && isValidImageUrl(url)) return url;
    }
  }
  if (item.mediaThumbnail) {
    const url = item.mediaThumbnail.$ ? item.mediaThumbnail.$.url : (typeof item.mediaThumbnail === 'string' ? item.mediaThumbnail : null);
    if (url && isValidImageUrl(url)) return url;
  }
  if (item.enclosure) {
    const enc = item.enclosure;
    const url = enc.url || (enc.$ ? enc.$.url : null);
    const type = enc.type || (enc.$ ? enc.$.type : '');
    if (url && (type.startsWith('image/') || isValidImageUrl(url))) return url;
  }
  if (item.itunes && item.itunes.image) {
    const url = typeof item.itunes.image === 'string' ? item.itunes.image : (item.itunes.image.href || null);
    if (url && isValidImageUrl(url)) return url;
  }
  return null;
}

function extractImageFromContent(html) {
  if (!html) return null;
  const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch && imgMatch[1] && isValidImageUrl(imgMatch[1])) return imgMatch[1];
  const dataSrcMatch = html.match(/<img[^>]+data-src=["']([^"']+)["']/i);
  if (dataSrcMatch && dataSrcMatch[1] && isValidImageUrl(dataSrcMatch[1])) return dataSrcMatch[1];
  return null;
}

function extractImageFromHTML(html, baseUrl) {
  if (!html) return null;
  try {
    const $ = cheerio.load(html);
    const ogImage = $('meta[property="og:image"]').attr('content');
    if (ogImage && isValidImageUrl(ogImage)) return makeAbsolute(ogImage, baseUrl);
    const twitterImage = $('meta[name="twitter:image"]').attr('content') || $('meta[property="twitter:image"]').attr('content');
    if (twitterImage && isValidImageUrl(twitterImage)) return makeAbsolute(twitterImage, baseUrl);
    let jsonLdImage = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html());
        if (jsonLdImage) return;
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (item.image) {
            if (typeof item.image === 'string') { jsonLdImage = item.image; break; }
            if (Array.isArray(item.image) && item.image.length) { jsonLdImage = typeof item.image[0] === 'string' ? item.image[0] : item.image[0].url; break; }
            if (item.image.url) { jsonLdImage = item.image.url; break; }
          }
        }
      } catch (e) {}
    });
    if (jsonLdImage && isValidImageUrl(jsonLdImage)) return makeAbsolute(jsonLdImage, baseUrl);
    const articleSelectors = ['article', '.article-body', '.article-content', '.post-content', '.entry-content', '.story-body', '.news-content', 'main'];
    for (const sel of articleSelectors) {
      const el = $(sel).first();
      if (el.length) {
        const img = el.find('img').first();
        const src = img.attr('data-src') || img.attr('src');
        if (src && isValidImageUrl(src) && !src.includes('icon') && !src.includes('logo') && !src.includes('avatar')) {
          return makeAbsolute(src, baseUrl);
        }
      }
    }
  } catch (e) {}
  return null;
}

function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  url = url.trim();
  if (url.startsWith('data:')) return false;
  if (url.length < 10) return false;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const lower = url.toLowerCase();
    const ext = lower.split('?')[0].split('#')[0].split('.').pop();
    const validExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico', 'tiff'];
    if (validExts.includes(ext)) return true;
    if (lower.includes('/image') || lower.includes('/photo') || lower.includes('/img') || lower.includes('/media') || lower.includes('/upload')) return true;
    return false;
  } catch (e) {
    return false;
  }
}

function makeAbsolute(url, baseUrl) {
  if (!url) return null;
  try {
    return new URL(url, baseUrl).href;
  } catch (e) {
    return url;
  }
}

// ─── RSS/Atom Fetcher ───
async function fetchRSS(url, proxyUrl) {
  const targetUrl = proxyUrl ? `${proxyUrl}${encodeURIComponent(url)}` : url;
  const feed = await rssParser.parseURL(targetUrl);
  return (feed.items || []).map(item => {
    let image = extractImageFromRSSItem(item);
    if (!image) image = extractImageFromContent(item['content:encoded'] || item.content || '');
    if (!image) image = extractImageFromContent(item.description || '');
    if (image) image = makeAbsolute(image, item.link || url);
    return {
      title: cleanText(item.title || ''),
      content: item['content:encoded'] || item.content || item.contentSnippet || item.description || '',
      summary: cleanText(item.contentSnippet || item.description || '').substring(0, 500),
      url: item.link || '',
      image: image || null,
      author: item.creator || item.author || feed.title || '',
      published_at: item.isoDate || item.pubDate || new Date().toISOString(),
      source_name: feed.title || ''
    };
  });
}

// ─── Website Scraper ───
async function fetchWebsite(url, proxyUrl) {
  const targetUrl = proxyUrl ? `${proxyUrl}${encodeURIComponent(url)}` : url;
  const res = await fetchWithRetry(targetUrl);
  const html = await res.text();
  const $ = cheerio.load(html);
  const articles = [];

  const rssLink = $('link[type="application/rss+xml"], link[type="application/atom+xml"]').first().attr('href');
  if (rssLink) {
    try {
      const fullRssUrl = rssLink.startsWith('http') ? rssLink : new URL(rssLink, url).href;
      return await fetchRSS(fullRssUrl, proxyUrl);
    } catch (e) { /* fall through */ }
  }

  const selectors = ['article', '.article', '.post', '.news-item', '.story', '.news-card', '.card', '.item', '.entry', '.list-item', '[class*="article"]', '[class*="news"]', '[class*="story"]', '.node--type-article', '.view-content .views-row'];
  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const $el = $(el);
      const titleEl = $el.find('h1, h2, h3, h4, .title, [class*="title"]').first();
      const title = cleanText(titleEl.text());
      if (!title || title.length < 10) return;
      const linkEl = $el.find('a[href]').first().add(titleEl.find('a[href]').first()).first();
      let link = linkEl.attr('href') || '';
      if (link && !link.startsWith('http')) link = new URL(link, url).href;
      let img = null;
      const imgEl = $el.find('img').first();
      img = imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || imgEl.attr('srcset')?.split(' ')[0] || imgEl.attr('src') || '';
      if (img && !img.startsWith('http') && img.startsWith('/')) img = new URL(img, url).href;
      const summaryEl = $el.find('p, .summary, .excerpt, .description, [class*="desc"]').first();
      const summary = cleanText(summaryEl.text()).substring(0, 500);
      const dateEl = $el.find('time, .date, .time, [class*="date"], [class*="time"]').first();
      const dateStr = dateEl.attr('datetime') || dateEl.text() || '';
      if (link && !articles.find(a => a.url === link)) {
        articles.push({ title, content: summary, summary, url: link, image: (img && isValidImageUrl(img)) ? img : null, author: '', published_at: dateStr ? parseArabicDate(dateStr) : new Date().toISOString(), source_name: '' });
      }
    });
    if (articles.length >= 5) break;
  }

  if (articles.length === 0) {
    $('a[href]').each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href') || '';
      const text = cleanText($a.text());
      if (text.length > 20 && href && (href.includes('/news/') || href.includes('/article/') || href.includes('/post/'))) {
        const fullUrl = href.startsWith('http') ? href : new URL(href, url).href;
        if (!articles.find(a => a.url === fullUrl)) {
          articles.push({ title: text, content: '', summary: '', url: fullUrl, image: null, author: '', published_at: new Date().toISOString(), source_name: '' });
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
    let img = null;
    const imgEl = $msg.find('.tgme_widget_message_photo_wrap').first();
    const bgStyle = imgEl.attr('style') || '';
    const bgMatch = bgStyle.match(/url\(['"]?(.*?)['"]?\)/);
    if (bgMatch) img = bgMatch[1];
    if (!img) { const imgTag = $msg.find('img').first(); img = imgTag.attr('src') || null; }
    const firstLine = text.split('\n')[0].substring(0, 150);
    articles.push({ title: firstLine, content: text, summary: text.substring(0, 300), url: msgLink, image: img, author: `@${channel}`, published_at: dateStr || new Date().toISOString(), source_name: `Telegram: ${channel}` });
  });
  return articles.slice(0, 30);
}

// ─── Article Detail Fetcher ───
async function fetchArticleDetail(url, proxyUrl) {
  try {
    const targetUrl = proxyUrl ? `${proxyUrl}${encodeURIComponent(url)}` : url;
    const res = await fetchWithRetry(targetUrl, { timeout: 12000 });
    const html = await res.text();
    const $ = cheerio.load(html);
    let image = extractImageFromHTML(html, url);
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const ogDesc = $('meta[property="og:description"]').attr('content') || '';
    let jsonLd = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html());
        if (data['@type'] === 'NewsArticle' || data['@type'] === 'Article') jsonLd = data;
      } catch (e) {}
    });
    const contentSelectors = ['article', '.article-body', '.article-content', '.post-content', '.entry-content', '.story-body', '.news-content', '.content-area', 'main .content', '.article-text'];
    let content = '';
    for (const sel of contentSelectors) {
      const el = $(sel).first();
      if (el.length && el.text().trim().length > 100) {
        el.find('script, style, nav, header, footer, .ads, .sidebar, .related, .comments').remove();
        content = el.html() || '';
        break;
      }
    }
    const author = (jsonLd && jsonLd.author) ? (typeof jsonLd.author === 'string' ? jsonLd.author : jsonLd.author.name || '') : $('meta[name="author"]').attr('content') || '';
    const datePublished = (jsonLd && jsonLd.datePublished) || $('meta[property="article:published_time"]').attr('content') || $('time').first().attr('datetime') || '';
    if (!image) {
      image = (jsonLd && jsonLd.image) ? (typeof jsonLd.image === 'string' ? jsonLd.image : Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image.url) : $('meta[property="og:image"]').attr('content') || $('article img, .article img, .content img').first().attr('src') || null;
      if (image) image = makeAbsolute(image, url);
    }
    return { title: ogTitle || (jsonLd && jsonLd.headline) || '', content: content || ogDesc || '', summary: ogDesc || (jsonLd && jsonLd.description) || '', image: image || null, author, published_at: datePublished || new Date().toISOString() };
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
    case 'rss': return fetchRSS(url, proxyUrl);
    case 'telegram': return fetchTelegram(url);
    case 'website': return fetchWebsite(url, proxyUrl);
    default: return fetchWebsite(url, proxyUrl);
  }
}

// ─── Deduplication (checks both existing AND deleted articles with fingerprinting) ───
function isDuplicate(article, db) {
  const crypto = require('crypto');
  
  // Check deleted_articles first — never re-add deleted content
  try {
    if (article.title && article.title.length > 10) {
      // Check by EXACT title only
      const deleted = db.prepare('SELECT id FROM deleted_articles WHERE title = ?').get(article.title);
      if (deleted) return true;
      
      // Check by content fingerprint (hash of FULL title)
      const contentHash = crypto.createHash('md5').update(article.title).digest('hex');
      const deletedByHash = db.prepare('SELECT id FROM deleted_articles WHERE content_hash = ?').get(contentHash);
      if (deletedByHash) return true;
    }
    if (article.url) {
      const deletedByUrl = db.prepare('SELECT id FROM deleted_articles WHERE source_url = ?').get(article.url);
      if (deletedByUrl) return true;
    }
  } catch(e) { /* deleted_articles table might not exist yet */ }

  // Check existing articles — EXACT title match ONLY
  const byTitle = db.prepare('SELECT id FROM news WHERE title = ? AND deleted_at IS NULL').get(article.title);
  if (byTitle) return true;

  // Check by source URL if available
  if (article.url) {
    const byUrl = db.prepare('SELECT id FROM news WHERE source_url = ? AND deleted_at IS NULL').get(article.url);
    if (byUrl) return true;
  }

  return false;
}

// ─── Save Article (skips if manually edited, stores fingerprint) ───
function saveArticle(article, source, db) {
  const crypto = require('crypto');
  const { classifyArticle } = require('./categorizer');
  
  // Check if a manually edited version exists with the same title
  try {
    const manuallyEdited = db.prepare('SELECT id FROM news WHERE title = ? AND is_manually_edited = 1 AND deleted_at IS NULL').get(article.title);
    if (manuallyEdited) return null; // Don't overwrite manual edits
  } catch(e) {}

  // Smart categorization: use source category first, then AI classification
  let categoryId = source.category_id || null;
  if (!categoryId) {
    try {
      categoryId = classifyArticle(article.title, article.content, article.summary, db);
    } catch(e) {}
  }

  const status = source.auto_publish ? 1 : 0;
  const { makeSlug } = require('../utils/slug');
  const slug = makeSlug(article.title);
  const publishedAt = article.published_at ? new Date(article.published_at).toISOString().slice(0, 19).replace('T', ' ') : new Date().toISOString().slice(0, 19).replace('T', ' ');
  const imageField = article.image || null;
  const content = article.content || article.summary || '';
  const summary = article.summary || (article.content ? article.content.substring(0, 300) : '');
  const contentHash = crypto.createHash('md5').update(article.title || '').digest('hex');

  const result = db.prepare(`INSERT INTO news (title, summary, content, image, category_id, source, is_breaking, is_slider, is_featured, status, published_at, created_at, updated_at, slug, source_url, content_hash, manual_fields) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, '')`).run(
    article.title.substring(0, 500), summary.substring(0, 1000), content, imageField, categoryId,
    article.source_name || source.name, status, publishedAt, slug, article.url || null, contentHash
  );
  return result.lastInsertRowid;
}

// ─── Full Fetch Pipeline for One Source ───
async function fetchAndSave(db, sourceId, triggeredBy = 'unknown') {
  const source = db.prepare('SELECT * FROM news_sources WHERE id = ?').get(sourceId);
  if (!source) throw new Error('Source not found');

  // Create log entry (handle missing triggered_by column)
  let logId = null;
  try {
    const logResult = db.prepare('INSERT INTO fetch_logs (source_id, status, triggered_by) VALUES (?, ?, ?)').run(sourceId, 'running', triggeredBy);
    logId = logResult.lastInsertRowid;
  } catch(e) {
    // triggered_by column doesn't exist, try without it
    try {
      const logResult = db.prepare('INSERT INTO fetch_logs (source_id, status) VALUES (?, ?)').run(sourceId, 'running');
      logId = logResult.lastInsertRowid;
    } catch(e2) {
      console.log('Could not create fetch log:', e2.message);
    }
  }

  let newCount = 0;
  let dupCount = 0;
  let imageCount = 0;
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
        // Enrich with detail page for website sources
        if (article.url && source.source_type === 'website' && (!article.content || article.content.length < 100)) {
          const detail = await fetchArticleDetail(article.url, source.use_proxy && source.proxy_url ? source.proxy_url : null);
          if (detail) {
            article.content = detail.content || article.content;
            article.image = article.image || detail.image;
            article.author = article.author || detail.author;
            if (detail.published_at) article.published_at = detail.published_at;
          }
        }

        // For RSS items without image, try detail page
        if (!article.image && article.url && source.source_type === 'rss') {
          const detail = await fetchArticleDetail(article.url, source.use_proxy && source.proxy_url ? source.proxy_url : null);
          if (detail && detail.image) article.image = detail.image;
        }

        if (article.image) imageCount++;
        saveArticle(article, source, db);
        newCount++;
      } catch (saveErr) {
        details += `\nSave error for "${article.title}": ${saveErr.message}`;
        // Continue with next article — don't fail the whole batch
      }
    }

    db.prepare(`UPDATE news_sources SET last_fetched_at = CURRENT_TIMESTAMP, next_fetch_at = CURRENT_TIMESTAMP + INTERVAL '1 second' * ?, last_fetch_status = 'success', last_error = NULL, total_fetched = total_fetched + ?, total_duplicates = total_duplicates + ?, last_new_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(source.fetch_interval, newCount, dupCount, newCount, sourceId);
    
    // Update log (handle missing image_count column)
    if (logId) {
      try {
        db.prepare(`UPDATE fetch_logs SET finished_at = CURRENT_TIMESTAMP, status = 'success', new_count = ?, duplicate_count = ?, image_count = ?, details = ? WHERE id = ?`).run(newCount, dupCount, imageCount, details, logId);
      } catch(e) {
        db.prepare(`UPDATE fetch_logs SET finished_at = CURRENT_TIMESTAMP, status = 'success', new_count = ?, duplicate_count = ?, details = ? WHERE id = ?`).run(newCount, dupCount, details, logId);
      }
    }

  } catch (err) {
    error = err.message || 'Unknown error';
    details += `\nError: ${error}`;
    db.prepare(`UPDATE news_sources SET last_fetched_at = CURRENT_TIMESTAMP, next_fetch_at = CURRENT_TIMESTAMP + INTERVAL '1 second' * ?, last_fetch_status = 'error', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(source.fetch_interval, error, sourceId);
    
    // Update log (handle missing image_count column)
    if (logId) {
      try {
        db.prepare(`UPDATE fetch_logs SET finished_at = CURRENT_TIMESTAMP, status = 'error', error_message = ?, details = ?, image_count = ? WHERE id = ?`).run(error, details, imageCount, logId);
      } catch(e) {
        db.prepare(`UPDATE fetch_logs SET finished_at = CURRENT_TIMESTAMP, status = 'error', error_message = ?, details = ? WHERE id = ?`).run(error, details, logId);
      }
    }
  }

  return { newCount, dupCount, imageCount, error, details };
}

// ─── Fetch All Active Sources (with locking + isolation) ───
async function fetchAllActive(db, triggeredBy = 'unknown') {
  // Check for existing lock (gracefully handle missing table)
  let existingLock = null;
  try {
    existingLock = isFetchLocked(db);
  } catch(e) { /* table doesn't exist */ }
  
  if (existingLock) {
    console.log(`Fetch skipped: locked by ${existingLock.locked_by}`);
    return {
      skipped: true,
      reason: `Already locked by ${existingLock.locked_by}`,
      results: []
    };
  }

  // Try to acquire lock (gracefully handle missing table)
  try {
    const lock = acquireLock(db, 'global_fetch', triggeredBy);
    if (!lock.acquired) {
      console.log(`Fetch skipped: could not acquire lock`);
      return {
        skipped: true,
        reason: `Could not acquire lock`,
        results: []
      };
    }
  } catch(e) {
    console.log('Lock not available, proceeding without lock');
  }

  console.log(`Fetch started by ${triggeredBy}`);

  try {
    const sources = db.prepare('SELECT * FROM news_sources WHERE is_active = 1').all();
    console.log(`Found ${sources.length} active sources`);
    
    const results = [];
    for (const source of sources) {
      console.log(`Fetching: ${source.name} (${source.url})`);
      try {
        const result = await fetchAndSave(db, source.id, triggeredBy);
        console.log(`  Result: ${result.newCount} new, ${result.dupCount} dup, error: ${result.error || 'none'}`);
        results.push({ sourceId: source.id, name: source.name, ...result });
      } catch (err) {
        console.log(`  Error: ${err.message}`);
        results.push({ sourceId: source.id, name: source.name, error: err.message });
        // Continue with next source — isolation
      }
    }

    const totalNew = results.reduce((sum, r) => sum + (r.newCount || 0), 0);
    const totalImages = results.reduce((sum, r) => sum + (r.imageCount || 0), 0);
    const errors = results.filter(r => r.error).length;

    return { skipped: false, triggeredBy, totalNew, totalImages, errors, results };
  } finally {
    releaseLock(db, 'global_fetch');
  }
}

// ─── Helpers ───
function cleanText(text) {
  return (text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
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
  saveArticle,
  extractImageFromRSSItem,
  extractImageFromContent,
  extractImageFromHTML,
  isValidImageUrl,
  acquireLock,
  releaseLock,
  isFetchLocked
};
