// Smart News Categorization Service
// Automatically classifies articles based on content analysis

const CATEGORY_RULES = {
  sports: {
    id: null, slug: 'sports',
    keywords: {
      strong: [
        'كرة القدم', 'الدوري', 'دوري', 'كأس', 'بطولة', 'مباراة', 'مباريات',
        'هدف', 'أهداف', 'لاعب', 'لاعبين', 'فريق', 'فرق', 'مدرب', 'تشكيلة',
        'المنتخب', 'منتخب', 'تصفيات', 'نهائي', 'نصف نهائي',
        'كرة السلة', 'كرة الطائرة', 'تنس', 'سباحة', 'ألعاب قوى', 'ملاكمة',
        'أولمبياد', 'بطولة آسيا', 'كأس العالم', 'دوري أبطال',
        'الهلال', 'النصر', 'الأهلي', 'الزمالك', 'برشلونة', 'ريال مدريد',
        'ليفربول', 'مانشستر', 'بايرن', 'يوفنتوس',
        'محمد صلاح', 'ميسي', 'رونالدو', 'نيمار', 'مبابي', 'هالاند',
        'الشوط الأول', 'الشوط الثاني', 'ركلة جزاء', 'بطاقة صفراء', 'بطاقة حمراء'
      ],
      medium: ['رياضة', 'رياضي', 'رياضية', 'ملعب', 'جمهور', 'جماهير', 'صفقة', 'انتقال']
    }
  },

  economy: {
    id: null, slug: 'economy',
    keywords: {
      strong: [
        'اقتصاد', 'اقتصادي', 'مصرف', 'بنك', 'بنكي',
        'عملة', 'صرف', 'دولار', 'ريال', 'يورو', 'جنيه', 'دينار',
        'تضخم', 'ناتج محلي', 'نمو اقتصادي', 'ركود',
        'استثمار', 'استثمارات', 'מניות', 'أسهم', 'بورصة',
        'نفط', 'نفطي', 'أسعار النفط', 'أوبك', 'بترول', 'غاز طبيعي',
        'تجارة', 'تجاري', 'تصدير', 'استيراد', 'جمارك', 'رسوم جمركية',
        'ضرائب', 'رواتب', 'أجور', 'معاشات', 'بطالة', 'سوق العمل',
        'غذاء', 'أسعار الغذاء', 'سلع', 'استهلاك'
      ],
      medium: ['مالي', 'مالية', 'ميزانية', 'بنك مركزي', 'تمويل', 'قرض']
    }
  },

  technology: {
    id: null, slug: 'technology',
    keywords: {
      strong: [
        'تكنولوجيا', 'تقنية', 'ذكاء اصطناعي',
        'روبوت', 'برمجة', 'تطبيق', 'تطبيقات',
        'هاتف ذكي', 'آيفون', 'آبل', 'سامسونج', 'هواوي',
        'فيسبوك', 'ميتا', 'جوجل', 'أمازون', 'مايكروسوفت', 'تسلا',
        'سيارة كهربائية', 'إنترنت', 'بلوكتشين', 'عملة رقمية', 'بيتكوين',
        'أمن سيبراني', 'اختراق', 'قرصنة', 'فيروس',
        'فضاء', 'ناسا', 'صاروخ', 'قمر صناعي'
      ],
      medium: ['رقمي', 'رقمية', 'إلكتروني', 'ابتكار']
    }
  },

  health: {
    id: null, slug: 'health',
    keywords: {
      strong: [
        'صحة', 'صحي', 'طب', 'طبي', 'طبيب', 'أطباء',
        'مرض', 'أمراض', 'علاج', 'دواء', 'أدوية', 'لقاح', 'تطعيم',
        'مستشفى', 'مستشفيات', 'عيادة', 'صيدلية',
        'جراحة', 'عملية جراحية', 'تبرع بالأعضاء',
        'وباء', 'جائحة', 'كورونا', 'كوفيد', 'إنفلونزا',
        'تغذية', 'نظام غذائي', 'سمنة',
        'صحة نفسية', 'اكتئاب', 'قلق',
        'منظمة الصحة', 'وزارة الصحة'
      ],
      medium: ['صحة', 'علاج', 'مرض', 'طبيب']
    }
  },

  education: {
    id: null, slug: 'education',
    keywords: {
      strong: [
        'تعليم', 'تربية', 'تربوي',
        'مدرسة', 'مدارس', 'معلم', 'طالب', 'طلاب', 'تلميذ',
        'جامعة', 'جامعات', 'كليات', 'كلية',
        'امتحان', 'امتحانات', 'اختبار', 'نتائج', 'نجاح', 'رسوب',
        'منهاج', 'منهج', 'كتب مدرسية',
        'تعليم عالي', 'وزارة التربية', 'وزارة التعليم', 'شهادة',
        'بحث علمي', 'أطروحة', 'ماجستير', 'دكتوراه'
      ],
      medium: ['تعليم', 'دراسة', 'مدرسة', 'جامعة']
    }
  },

  reports: {
    id: null, slug: 'reports',
    keywords: {
      strong: [
        'تقرير', 'تقارير', 'تحقيق', 'تحقيقات', 'كشف', 'يكشف',
        'دراسة', 'دراسات', 'بحث', 'أبحاث', 'إحصائيات',
        'رصد', 'يرصد', 'توثيق', 'تحليل', 'تحليلات',
        'حصيلة', 'خلاصة', 'نتائج', 'استطلاع'
      ],
      medium: ['استقصائي', 'ميداني', 'شامل', 'مفصل', 'موثق']
    }
  },

  culture: {
    id: null, slug: 'culture',
    keywords: {
      strong: [
        'ثقافة', 'ثقافي', 'فن', 'فني', 'فنان', 'فنانون',
        'أدب', 'أديب', 'رواية', 'شعر', 'شاعر',
        'مسرح', 'سينما', 'فيلم', 'أفلام', 'مسلسل',
        'موسيقى', 'أغنية', 'حفل', 'حفلات',
        'معرض', 'متحف', 'تراث',
        'كتاب', 'كتب', 'نشر', 'دار نشر', 'مكتبة',
        'جائزة', 'جوائز', 'مهرجان', 'أوسكار', 'نوبل'
      ],
      medium: ['ثقافة', 'إبداع']
    }
  },

  agriculture: {
    id: null, slug: 'agriculture',
    keywords: {
      strong: [
        'زراعة', 'زراعي', 'مزارع', 'فلاح',
        'محاصيل', 'محصول', 'قمح', 'أرز', 'ذرة',
        'فواكه', 'خضروات', 'تمور',
        'ماشية', 'أبقار', 'أغنام', 'دواجن',
        'صيد', 'سمك', 'ثروة سمكية',
        'ري', 'موارد مائية', 'سدود', 'جفاف',
        'أسمدة', 'مبيدات', 'آفات'
      ],
      medium: ['أرض', 'مزرعة', 'غابات', 'تشجير']
    }
  },

  development: {
    id: null, slug: 'development',
    keywords: {
      strong: [
        'تنمية', 'تنموي', 'مبادرة', 'مبادرات', 'مشروع', 'مشاريع',
        'إغاثة', 'إنساني', 'إنسانية', 'مساعدات',
        'نازحين', 'لاجئين', 'مخيم',
        'إعمار', 'إعادة إعمار', 'بنية تحتية', 'طرق', 'جسور',
        'كهرباء', 'طاقة', 'طاقة شمسية',
        'مياه', 'صرف صحي', 'بيئة'
      ],
      medium: ['خيري', 'خيرية', 'تبرع', 'دعم']
    }
  },

  parties: {
    id: null, slug: 'parties',
    keywords: {
      strong: [
        'حزب', 'أحزاب', 'تنظيم', 'منظمات', 'اتحاد',
        'مؤتمر', 'مؤتمرات', 'ندوة',
        'انتخابات', 'انتخابي', 'تصويت', 'مرشح',
        'برلمان', 'نواب', 'مجلس نواب', 'مجلس شورى',
        'قانون', 'قوانين', 'تشريع', 'دستور'
      ],
      medium: ['سياسي', 'سياسة', 'معارضة', 'تحالف']
    }
  },

  tourism: {
    id: null, slug: 'tourism',
    keywords: {
      strong: [
        'سياحة', 'سياحي', 'سياح', 'زوار',
        'فندق', 'فنادق', 'منتجع', 'مطار',
        'طيران', 'رحلات', 'رحلة', 'سفر',
        'آثار', 'أثري', 'تاريخي',
        'جزيرة', 'جزر', 'سقطرى', 'شواطئ',
        'جواز سفر', 'تأشيرة', 'حدود'
      ],
      medium: ['استكشاف', 'طبيعة', 'مناظر طبيعية']
    }
  },

  services: {
    id: null, slug: 'services',
    keywords: {
      strong: [
        'خدمات', 'خدمة', 'مشروع', 'مشاريع', 'إنجاز',
        'تطوير', 'تحديث', 'تحسين',
        'رقمي', 'رقمية', 'تطبيق', 'منصة',
        'تقنية', 'تكنولوجيا', 'ذكاء اصطناعي',
        'حكومة إلكترونية', 'خدمات إلكترونية', 'تحول رقمي'
      ],
      medium: ['خدمة', 'تطوير', 'تحسين']
    }
  }
};

// Resolve category IDs from database
function resolveCategoryIds(db) {
  try {
    const categories = db.prepare('SELECT id, slug FROM categories').all();
    for (const [key, rule] of Object.entries(CATEGORY_RULES)) {
      const cat = categories.find(c => c.slug === rule.slug);
      if (cat) rule.id = cat.id;
    }
  } catch(e) {}
}

// Normalize Arabic text for matching
function normalizeText(text) {
  return (text || '')
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Calculate relevance score
function calculateScore(text, rules) {
  const normalized = normalizeText(text);
  let score = 0;

  if (rules.strong) {
    for (const keyword of rules.strong) {
      if (normalized.includes(normalizeText(keyword))) score += 3;
    }
  }
  if (rules.medium) {
    for (const keyword of rules.medium) {
      if (normalized.includes(normalizeText(keyword))) score += 1;
    }
  }
  return score;
}

// Main classification function
function classifyArticle(title, content, summary, db) {
  if (!CATEGORY_RULES.sports.id) resolveCategoryIds(db);

  const combinedText = `${title || ''} ${summary || ''} ${content || ''}`;
  let bestCategory = null;
  let bestScore = 0;

  for (const [key, rule] of Object.entries(CATEGORY_RULES)) {
    if (!rule.id) continue;
    const score = calculateScore(combinedText, rule.keywords);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = key;
    }
  }

  if (bestCategory && bestScore >= 3) return CATEGORY_RULES[bestCategory].id;
  return null;
}

// Classify and update article
function classifyAndUpdate(db, newsId) {
  const article = db.prepare('SELECT id, title, summary, content, category_id FROM news WHERE id = ?').get(newsId);
  if (!article || article.category_id) return article?.category_id;

  const categoryId = classifyArticle(article.title, article.content, article.summary, db);
  if (categoryId) {
    db.prepare('UPDATE news SET category_id = ? WHERE id = ?').run(categoryId, newsId);
    return categoryId;
  }
  return null;
}

module.exports = { classifyArticle, classifyAndUpdate, resolveCategoryIds, CATEGORY_RULES };
