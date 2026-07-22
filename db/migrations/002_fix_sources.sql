-- Fix broken news sources - update to working RSS feeds
-- This migration updates existing sources to use working URLs

-- Update saba.ye sources to BBC Arabic
UPDATE news_sources SET 
  name = 'BBC Arabic RSS',
  url = 'https://feeds.bbci.co.uk/arabic/rss.xml',
  source_type = 'rss',
  category_id = 2,
  last_fetch_status = 'pending',
  last_error = NULL,
  updated_at = CURRENT_TIMESTAMP
WHERE url LIKE '%saba.ye%';

-- Update almassirah.net to Al Jazeera English
UPDATE news_sources SET 
  name = 'Al Jazeera English RSS',
  url = 'https://www.aljazeera.com/xml/rss/all.xml',
  source_type = 'rss',
  category_id = 2,
  last_fetch_status = 'pending',
  last_error = NULL,
  updated_at = CURRENT_TIMESTAMP
WHERE url LIKE '%almassirah.net%';

-- Update alarabiya.net to France 24
UPDATE news_sources SET 
  name = 'France 24 Arabic RSS',
  url = 'https://www.francetvinfo.fr/titres.rss',
  source_type = 'rss',
  category_id = 2,
  last_fetch_status = 'pending',
  last_error = NULL,
  updated_at = CURRENT_TIMESTAMP
WHERE url LIKE '%alarabiya.net%';

-- Update aljazeera.net to correct Al Jazeera URL
UPDATE news_sources SET 
  name = 'Al Jazeera RSS',
  url = 'https://www.aljazeera.com/xml/rss/all.xml',
  source_type = 'rss',
  category_id = 2,
  last_fetch_status = 'pending',
  last_error = NULL,
  updated_at = CURRENT_TIMESTAMP
WHERE url LIKE '%aljazeera.net%';

-- Add new working sources if they don't exist
INSERT INTO news_sources (name, url, source_type, category_id, is_active, fetch_interval, auto_publish, next_fetch_at, last_fetch_status)
SELECT 'BBC Arabic', 'https://feeds.bbci.co.uk/arabic/rss.xml', 'rss', 2, 1, 900, 1, CURRENT_TIMESTAMP, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM news_sources WHERE url = 'https://feeds.bbci.co.uk/arabic/rss.xml');

INSERT INTO news_sources (name, url, source_type, category_id, is_active, fetch_interval, auto_publish, next_fetch_at, last_fetch_status)
SELECT 'Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml', 'rss', 2, 1, 900, 1, CURRENT_TIMESTAMP, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM news_sources WHERE url = 'https://www.aljazeera.com/xml/rss/all.xml');

INSERT INTO news_sources (name, url, source_type, category_id, is_active, fetch_interval, auto_publish, next_fetch_at, last_fetch_status)
SELECT 'France 24', 'https://www.francetvinfo.fr/titres.rss', 'rss', 2, 1, 1200, 1, CURRENT_TIMESTAMP, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM news_sources WHERE url = 'https://www.francetvinfo.fr/titres.rss');

INSERT INTO news_sources (name, url, source_type, category_id, is_active, fetch_interval, auto_publish, next_fetch_at, last_fetch_status)
SELECT 'Sky News Arabia', 'https://www.skynewsarabia.com/web/rss.xml', 'rss', 2, 1, 1200, 1, CURRENT_TIMESTAMP, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM news_sources WHERE url = 'https://www.skynewsarabia.com/web/rss.xml');

-- Deactivate broken sources
UPDATE news_sources SET is_active = 0, last_fetch_status = 'disabled', last_error = 'URL not working'
WHERE url LIKE '%maribpress.net%' OR url LIKE '%newyemen.net%';
