const { fetchArticleDetail } = require('./news-fetcher');

const inFlight = new Map();

function plainText(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function meaningfulWords(value) {
  return new Set(
    plainText(value)
      .toLowerCase()
      .replace(/[^\u0600-\u06FF\u0750-\u077F\u08A0-\u08FFa-z0-9 ]/gi, ' ')
      .split(/\s+/)
      .filter(word => word.length >= 3)
  );
}

function titlesRelated(first, second) {
  const a = meaningfulWords(first);
  const b = meaningfulWords(second);
  if (!a.size || !b.size) return true;
  let overlap = 0;
  for (const word of a) if (b.has(word)) overlap++;
  return overlap >= 2 || overlap / Math.max(1, Math.min(a.size, b.size)) >= 0.25;
}

function needsFullContent(article) {
  if (!article || !article.source_url || Number(article.is_manually_edited) === 1) return false;
  const content = plainText(article.content);
  const summary = plainText(article.summary);
  if (content.length < 350) return true;
  if (summary && content.length <= summary.length + 80) return true;
  return false;
}

async function enrichArticleIfNeeded(db, article) {
  if (!needsFullContent(article)) return { article, changed: false, status: 'already-full' };
  if (inFlight.has(article.id)) return inFlight.get(article.id);

  const task = (async () => {
    try {
      const detail = await Promise.race([
        fetchArticleDetail(article.source_url),
        new Promise(resolve => setTimeout(() => resolve(null), 18000))
      ]);
      const newTextLength = plainText(detail && detail.content);
      const oldTextLength = plainText(article.content).length;
      if (!detail || newTextLength < 350 || newTextLength <= oldTextLength + 80 || !titlesRelated(article.title, detail.title)) {
        return { article, changed: false, status: 'source-unavailable' };
      }

      db.prepare(`
        UPDATE news
        SET content = ?, image = COALESCE(image, ?), updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND COALESCE(is_manually_edited, 0) = 0
      `).run(detail.content, detail.image || null, article.id);

      return {
        article: { ...article, content: detail.content, image: article.image || detail.image || null, updated_at: new Date().toISOString() },
        changed: true,
        status: 'enriched',
        source: detail.source_url,
        extractor: detail.extractor,
        characters: newTextLength
      };
    } catch (error) {
      return { article, changed: false, status: 'source-unavailable', error: error.message };
    } finally {
      inFlight.delete(article.id);
    }
  })();

  inFlight.set(article.id, task);
  return task;
}

module.exports = { enrichArticleIfNeeded, needsFullContent, plainText };
