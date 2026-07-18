const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'saba.db');
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDatabase() {
  const db = getDb();

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_ar TEXT NOT NULL,
      name_en TEXT,
      slug TEXT UNIQUE,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      summary TEXT,
      content TEXT,
      image TEXT,
      category_id INTEGER,
      source TEXT,
      is_breaking INTEGER DEFAULT 0,
      is_slider INTEGER DEFAULT 0,
      is_featured INTEGER DEFAULT 0,
      views INTEGER DEFAULT 0,
      status INTEGER DEFAULT 1,
      published_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      meta_title TEXT,
      meta_description TEXT,
      slug TEXT,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS news_tags (
      news_id INTEGER,
      tag_id INTEGER,
      PRIMARY KEY (news_id, tag_id),
      FOREIGN KEY (news_id) REFERENCES news(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT,
      file_path TEXT NOT NULL,
      thumbnail TEXT,
      description TEXT,
      category TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS breaking_news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      link TEXT,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS slider (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      news_id INTEGER,
      image TEXT,
      title TEXT,
      summary TEXT,
      link TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (news_id) REFERENCES news(id)
    );

    CREATE TABLE IF NOT EXISTS advertisements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      position TEXT,
      code TEXT,
      image TEXT,
      link TEXT,
      start_date DATE,
      end_date DATE,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT,
      role TEXT DEFAULT 'editor',
      last_login DATETIME
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_news_category ON news(category_id);
    CREATE INDEX IF NOT EXISTS idx_news_status ON news(status);
    CREATE INDEX IF NOT EXISTS idx_news_published ON news(published_at);
    CREATE INDEX IF NOT EXISTS idx_news_breaking ON news(is_breaking);
    CREATE INDEX IF NOT EXISTS idx_news_slider ON news(is_slider);
    CREATE INDEX IF NOT EXISTS idx_news_featured ON news(is_featured);

    -- Comments table
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      news_id INTEGER NOT NULL,
      author_name TEXT NOT NULL,
      author_email TEXT,
      content TEXT NOT NULL,
      status INTEGER DEFAULT 0,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (news_id) REFERENCES news(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_comments_news ON comments(news_id);
    CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status);

    -- Polls table
    CREATE TABLE IF NOT EXISTS polls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME
    );

    -- Poll options
    CREATE TABLE IF NOT EXISTS poll_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER NOT NULL,
      option_text TEXT NOT NULL,
      votes INTEGER DEFAULT 0,
      FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
    );

    -- Poll votes (to prevent double voting)
    CREATE TABLE IF NOT EXISTS poll_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER NOT NULL,
      option_id INTEGER NOT NULL,
      ip_address TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
      FOREIGN KEY (option_id) REFERENCES poll_options(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(poll_id, ip_address);

    -- Newsletter subscribers
    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      unsubscribed_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_newsletter_email ON newsletter_subscribers(email);

    -- Newsletter campaigns
    CREATE TABLE IF NOT EXISTS newsletter_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      content TEXT NOT NULL,
      sent_at DATETIME,
      recipients_count INTEGER DEFAULT 0,
      status INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Check if data exists
  const count = db.prepare('SELECT COUNT(*) as cnt FROM categories').get();
  if (count.cnt === 0) {
    seedData(db);
  }
}

function seedData(db) {
  // Seed categories
  const insertCat = db.prepare('INSERT INTO categories (name_ar, name_en, slug, sort_order) VALUES (?, ?, ?, ?)');
  const categories = [
    ['محلي', 'Local', 'local', 1],
    ['عربي دولي', 'Arab International', 'arab-international', 2],
    ['تقارير وتحقيقات', 'Reports', 'reports', 3],
    ['اقتصاد', 'Economy', 'economy', 4],
    ['رياضة', 'Sports', 'sports', 5],
    ['ثقافة', 'Culture', 'culture', 6],
    ['متفرقات', 'Miscellaneous', 'misc', 7],
    ['قائد الثورة', 'Revolution Leader', 'revolution-leader', 8],
    ['رئيس الجمهورية', 'President', 'president', 9],
    ['العدوان الأمريكي السعودي', 'US-Saudi Aggression', 'us-saudi-aggression', 10],
    ['الزراعة', 'Agriculture', 'agriculture', 11],
    ['التنمية والمبادرات المجتمعية', 'Development', 'development', 12],
    ['أحزاب ومنظمات', 'Parties', 'parties', 13],
    ['سياحة', 'Tourism', 'tourism', 14],
    ['خدمات ومشاريع', 'Services', 'services', 15]
  ];
  for (const cat of categories) {
    insertCat.run(...cat);
  }

  // Seed tags
  const insertTag = db.prepare('INSERT INTO tags (name, slug) VALUES (?, ?)');
  const tags = [
    ['اليمن', 'yemen'],
    ['صنعاء', 'sanaa'],
    ['عدن', 'aden'],
    ['الحديدة', 'hodeidah'],
    ['المكلا', 'mukalla'],
    ['تعز', 'taiz'],
    ['مارب', 'marib'],
    ['الحوثي', 'houthi'],
    ['المقاومة', 'resistance'],
    ['سلام', 'peace'],
    ['اقتصاد', 'economy'],
    ['رياضة', 'sports'],
    ['صحة', 'health'],
    ['تعليم', 'education'],
    ['بنية تحتية', 'infrastructure']
  ];
  for (const tag of tags) {
    insertTag.run(...tag);
  }

  // Seed admin user (password: admin123)
  const bcrypt = require('bcryptjs');
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admin_users (username, password, name, role) VALUES (?, ?, ?, ?)').run('admin', hashedPassword, 'مدير النظام', 'admin');

  // Seed settings
  const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const settingsData = [
    ['site_name', 'وكالة سبأ للأنباء'],
    ['site_name_en', 'SABA News Agency'],
    ['site_description', 'وكالة الأنباء اليمنية سبأ - المصدر الأول للأخبار في اليمن'],
    ['site_keywords', 'سبأ, أخبار, اليمن, وكالة أنباء, يمني'],
    ['site_logo', '/images/logo.png'],
    ['site_favicon', '/images/favicon.ico'],
    ['contact_email', 'info@saba.ye'],
    ['contact_phone', '+967-1-234567'],
    ['contact_address', 'صنعاء، الجمهورية اليمنية'],
    ['facebook', 'https://facebook.com/sabanews'],
    ['twitter', 'https://twitter.com/sabanews'],
    ['youtube', 'https://youtube.com/sabanews'],
    ['telegram', 'https://t.me/sabanews'],
    ['articles_per_page', '20'],
    ['enable_comments', '0'],
    ['analytics_code', '']
  ];
  for (const [key, value] of settingsData) {
    insertSetting.run(key, value);
  }

  // Seed 35 sample news articles
  const insertNews = db.prepare(`INSERT INTO news (title, summary, content, image, category_id, source, is_breaking, is_slider, is_featured, views, status, published_at, created_at, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertNewsTag = db.prepare('INSERT INTO news_tags (news_id, tag_id) VALUES (?, ?)');

  const sampleNews = [
    {
      title: 'المجلس السياسي الأعلى يعقد اجتماعاً طارئاً لمناقشة التطورات الأمنية',
      summary: 'عقد المجلس السياسي الأعلى اجتماعاً طارئاً برئاسة الرئيس مهدي المشاط لمناقشة آخر التطورات الأمنية والسياسية في البلاد.',
      content: '<p>عقد المجلس السياسي الأعلى اليوم اجتماعاً طارئاً برئاسة الرئيس مهدي المشاط، نائب رئيس المجلس، وذلك لمناقشة آخر التطورات الأمنية والسياسية في البلاد.</p><p>وتناول الاجتماع الوضع العام في مختلف المحافظات، والإجراءات اللازمة لتعزيز الأمن والاستقرار، وسبل مواجهة التحديات الراهنة.</p><p>وأكد المجلس على أهمية التلاحم بين أبناء الشعب اليمني والوقوف صفاً واحداً في مواجهة التحديات.</p>',
      image: '/images/uploads/news1.jpg',
      category_id: 1,
      source: 'سبأ',
      is_breaking: 1,
      is_slider: 1,
      is_featured: 1,
      views: 1523,
      tags: [1, 2]
    },
    {
      title: 'وزير الخارجية: اليمن تؤكد دعمها للقضية الفلسطينية',
      summary: 'أكد وزير الخارجية أن اليمن تدعم القضية الفلسطينية وستواصل دعمها السياسي والمعنوي للشعب الفلسطيني.',
      content: '<p>أكد وزير الخارجية في حكومة الإنقاذ الوطني أن اليمن تؤكد دعمها الثابت والراسخ للقضية الفلسطينية وللشعب الفلسطيني في نضاله المشروع.</p><p>وأشار إلى أن اليمن تقف إلى جانب الشعب الفلسطيني في مواجهة الاحتلال الإسرائيلي، وتدعم حقه في تقرير مصيره وإقامة دولته المستقلة.</p>',
      image: '/images/uploads/news2.jpg',
      category_id: 2,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 1,
      is_featured: 1,
      views: 987,
      tags: [1]
    },
    {
      title: 'تقرير: الاقتصاد اليمني يواجه تحديات كبيرة في ظل الحصار',
      summary: 'كشف تقرير اقتصادي جديد عن التحديات الكبيرة التي يواجهها الاقتصاد اليمني بسبب الحصار المستمر والحرب.',
      content: '<p>كشف تقرير اقتصادي صادر عن مركز الدراسات الاقتصادية اليمنية عن التحديات الكبيرة التي يواجهها الاقتصاد اليمني في ظل الحصار المستمر والحرب التي تشنها التحالف السعودي الإماراتي.</p><p>وأوضح التقرير أن الناتج المحلي الإجمالي تراجع بنسبة كبيرة، وأن معدلات الفقر والبطالة ارتفعت بشكل ملحوظ.</p>',
      image: '/images/uploads/news3.jpg',
      category_id: 4,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 1,
      views: 654,
      tags: [1, 11]
    },
    {
      title: 'المنتخب اليمني يتأهل إلى نهائيات كأس آسيا للمرة الأولى',
      summary: 'حقق المنتخب اليمني لكرة القدم إنجازاً تاريخياً بالتأهل إلى نهائيات كأس آسيا.',
      content: '<p>حقق المنتخب اليمني لكرة القدم إنجازاً تاريخياً بالتأهل إلى نهائيات كأس آسيا للمرة الأولى في تاريخه، بعد فوزه المستحق في التصفيات.</p><p>وقد احتشد球迷 في شوارع صنعاء وعدن ومدن يمنية أخرى احتفالاً بهذا الإنجاز التاريخي.</p>',
      image: '/images/uploads/news4.jpg',
      category_id: 5,
      source: 'سبأ',
      is_breaking: 1,
      is_slider: 1,
      is_featured: 1,
      views: 2341,
      tags: [1, 12]
    },
    {
      title: 'قائد الثورة يلقي كلمة بمناسبة ذكرى ثورة 21 سبتمبر',
      summary: 'ألقى قائد الثورة السيد عبد الملك الحوثي كلمة بمناسبة الذكرى السنوية لثورة 21 سبتمبر المجيدة.',
      content: '<p>ألقى قائد الثورة السيد عبد الملك الحوثي كلمة هامة بمناسبة الذكرى السنوية لثورة 21 سبتمبر المجيدة، أكد فيها على مواصلة المسيرة نحو النصر والتحرير.</p><p>وأشاد بدور الشعب اليمني في الدفاع عن سيادة البلاد واستقلالها، وأكد على أهمية الوحدة الوطنية.</p>',
      image: '/images/uploads/news5.jpg',
      category_id: 8,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 1,
      is_featured: 1,
      views: 3456,
      tags: [1, 8]
    },
    {
      title: 'رئيس الجمهورية يبحث مع السفير الإيراني تطوير العلاقات الثنائية',
      summary: 'بحث رئيس الجمهورية مع السفير الإيراني سبل تطوير العلاقات الثنائية بين البلدين في مختلف المجالات.',
      content: '<p>بحث رئيس الجمهورية مهدي المشاط مع السفير الإيراني في صنعاء سبل تطوير وتعزيز العلاقات الثنائية بين البلدين الشقيقين في مختلف المجالات السياسية والاقتصادية والثقافية.</p>',
      image: '/images/uploads/news6.jpg',
      category_id: 9,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 432,
      tags: [1]
    },
    {
      title: 'ملخص: حصيلة جرائم العدوان الأمريكي السعودي خلال الشهر الماضي',
      summary: 'أصدر المركز اليمني لحقوق الإنسان تقريراً يوثق حصيلة جرائم العدوان الأمريكي السعودي خلال الشهر الماضي.',
      content: '<p>أصدر المركز اليمني لحقوق الإنسان تقريراً شاملاً يوثق حصيلة جرائم العدوان الأمريكي السعودي على اليمن خلال الشهر الماضي.</p><p>وأظهر التقرير مقتل وإصابة المئات من المدنيين، من بينهم نساء وأطفال، في غارات جوية متكررة على مختلف المحافظات.</p>',
      image: '/images/uploads/news7.jpg',
      category_id: 10,
      source: 'سبأ',
      is_breaking: 1,
      is_slider: 0,
      is_featured: 1,
      views: 1876,
      tags: [1]
    },
    {
      title: 'وزارة الزراعة تطلق حملة لتشجير المناطق المتضررة',
      summary: 'أطلقت وزارة الزراعة حملة وطنية لتشجير المناطق المتضررة من الغارات والحروب.',
      content: '<p>أطلقت وزارة الزراعة والري حملة وطنية واسعة لتشجير المناطق المتضررة من الغارات الجوية والحروب المستمرة.</p><p>وتهدف الحملة إلى زراعة مليون شجرة في مختلف المحافظات اليمنية خلال العام الجاري.</p>',
      image: '/images/uploads/news8.jpg',
      category_id: 11,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 321,
      tags: [1]
    },
    {
      title: 'إطلاق مبكرة تنميةية لدعم الأسر المحتاجة في تعز',
      summary: 'أطلقت مؤسسة خيرية مبكرة تنميةية لدعم الأسر المحتاجة والمتضررة في محافظة تعز.',
      content: '<p>أطلقت مؤسسة الإغاثة الخيرية مبكرة تنميةية شاملة لدعم الأسر المحتاجة والمتضررة في محافظة تعز، تشمل المساعدات الغذائية والصحية والتعليمية.</p>',
      image: '/images/uploads/news9.jpg',
      category_id: 12,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 234,
      tags: [1, 6]
    },
    {
      title: 'المؤتمر الشعبي العام يدين العدوان المتواصل على غزة',
      summary: 'أدانت الأمانة العامة للمؤتمر الشعبي العام العدوان الإسرائيلي المتواصل على قطاع غزة.',
      content: '<p>أدانت الأمانة العامة للمؤمر الشعبي العام العدوان الإسرائيلي الوحشي المتواصل على قطاع غزة، ودعت المجتمع الدولي للتدخل لوقف هذا العدوان.</p>',
      image: '/images/uploads/news10.jpg',
      category_id: 13,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 567,
      tags: [1]
    },
    {
      title: 'السياحة اليمنية: كنوز مخفية تنتظر من يكتشفها',
      summary: 'تعد اليمن من أغنى الدول العربية من حيث المواقع السياحية والأثرية التي تنتظر من يكتشفها.',
      content: '<p>تعد اليمن من أغنى الدول العربية من حيث المواقع السياحية والأثرية، حيث تمتلك تاريخاً حضارياً عريقاً يمتد لآلاف السنين.</p><p>ومن أبرز المواقع السياحية جزيرة سقطرى، وصنعاء القديمة، وشبام حضرموت، وتعز التاريخية.</p>',
      image: '/images/uploads/news11.jpg',
      category_id: 14,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 456,
      tags: [1]
    },
    {
      title: 'وزارة الصحة تعلن عن حملة تطعيم شاملة للأطفال',
      summary: 'أعلنت وزارة الصحة عن إطلاق حملة تطعيم شاملة للأطفال في مختلف المحافظات.',
      content: '<p>أعلنت وزارة الصحة العامة والسكان عن إطلاق حملة تطعيم شاملة تستهدف الأطفال تحت سن الخامسة في مختلف المحافظات اليمنية.</p><p>وتهدف الحملة إلى منع انتشار الأمراض المعدية وحماية صحة الأطفال.</p>',
      image: '/images/uploads/news12.jpg',
      category_id: 1,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 345,
      tags: [1, 13]
    },
    {
      title: 'افتتاح طريق جديد يربط صنعاء بعدد من المحافظات',
      summary: 'افتُتح طريق جديد يربط العاصمة صنعاء بعدد من المحافظات اليمنية لتسهيل حركة النقل.',
      content: '<p>افتُتح اليوم طريق جديد يربط العاصمة صنعاء بعدد من المحافظات اليمنية، وذلك في إطار جهود تطوير البنية التحتية وتسهيل حركة النقل والمواصلات.</p>',
      image: '/images/uploads/news13.jpg',
      category_id: 1,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 289,
      tags: [1, 15]
    },
    {
      title: 'ارتفاع أسعار النفط عالمياً وتأثيره على الاقتصاد اليمني',
      summary: 'رصد تقرير اقتصادي تأثير ارتفاع أسعار النفط العالمية على الاقتصاد اليمني.',
      content: '<p>رصد تقرير اقتصادي جديد تأثير ارتفاع أسعار النفط العالمية على الاقتصاد اليمني، حيث أدى ذلك إلى زيادة تكاليف الاستيراد والنقل.</p>',
      image: '/images/uploads/news14.jpg',
      category_id: 4,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 412,
      tags: [1, 11]
    },
    {
      title: 'بطولة كرة القدم المحلية تعود بعد توقف طويل',
      summary: 'عادت بطولة كرة القدم المحلية في اليمن بعد توقف طويل بسبب الحرب والحصار.',
      content: '<p>عادت بطولة كرة القدم المحلية في اليمن بعد توقف طويل بسبب الحرب والحصار، حيث انطلقت مباريات البطولة بمشاركة فرق من مختلف المحافظات.</p>',
      image: '/images/uploads/news15.jpg',
      category_id: 5,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 678,
      tags: [1, 12]
    },
    {
      title: 'معرض الكتاب العربي يفتتح في صنعاء بمشاركة واسعة',
      summary: 'افتُتح معرض الكتاب العربي في العاصمة صنعاء بمشاركة واسعة من دور النشر اليمنية والعربية.',
      content: '<p>افتُتح معرض الكتاب العربي في العاصمة صنعاء بمشاركة واسعة من دور النشر اليمنية والعربية، ويضم المعرض آلاف العناوين في مختلف المجالات.</p>',
      image: '/images/uploads/news16.jpg',
      category_id: 6,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 234,
      tags: [1]
    },
    {
      title: 'الأرصاد الجوية تحذر من أمطار غزيرة في عدد من المحافظات',
      summary: 'حذرت الأرصاد الجوية من أمطار غزيرة مرتقبة في عدد من المحافظات اليمنية.',
      content: '<p>حذرت الهيئة العامة للأرصاد الجوية من أمطار غزيرة مرتقبة في عدد من المحافظات اليمنية خلال الأيام القادمة، ودعت المواطنين لاتخاذ الاحتياطات اللازمة.</p>',
      image: '/images/uploads/news17.jpg',
      category_id: 7,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 567,
      tags: [1]
    },
    {
      title: 'الجيش اليمني يصد هجوماً لقوات العدو في مأرب',
      summary: 'صد الجيش اليمني واللجان الشعبية هجوماً لقوات العدو في جبهة مأرب.',
      content: '<p>صد الجيش اليمني واللجان الشعبية هجوماً عنيفاً شنته قوات العدو في جبهة مأرب، محققاً إصابات مؤكدة في صفوف العدو.</p>',
      image: '/images/uploads/news18.jpg',
      category_id: 10,
      source: 'سبأ',
      is_breaking: 1,
      is_slider: 0,
      is_featured: 0,
      views: 1234,
      tags: [1, 7]
    },
    {
      title: 'وزير التربية والتعليم يعلن عن خطة لتطوير المنظومة التعليمية',
      summary: 'أعلن وزير التربية والتعليم عن خطة شاملة لتطوير المنظومة التعليمية في اليمن.',
      content: '<p>أعلن وزير التربية والتعليم عن خطة شاملة ومتكاملة لتطوير المنظومة التعليمية في اليمن، تشمل تحديث المناهج وتدريب المعلمين وتوفير بيئة تعليمية ملائمة.</p>',
      image: '/images/uploads/news19.jpg',
      category_id: 1,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 345,
      tags: [1, 14]
    },
    {
      title: 'إحصائيات: أكثر من 10 آلاف مشروع صغير تم تمويله هذا العام',
      summary: 'أظهرت إحصائيات أن أكثر من 10 آلاف مشروع صغير تم تمويله خلال العام الجاري.',
      content: '<p>أظهرت إحصائيات صادرة عن صندوق التنمية الاجتماعية أن أكثر من 10 آلاف مشروع صغير ومتوسط تم تمويله خلال العام الجاري، مما ساهم في خلق فرص عمل للشباب.</p>',
      image: '/images/uploads/news20.jpg',
      category_id: 4,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 456,
      tags: [1, 11]
    },
    {
      title: 'المقاومة اليمنية تعلن عن عملية عسكرية جديدة ضد العدو',
      summary: 'أعلنت المقاومة اليمنية عن تنفيذ عملية عسكرية جديدة ضد قوات العدو السعودي الإماراتي.',
      content: '<p>أعلنت المقاومة اليمنية عن تنفيذ عملية عسكرية جديدة نوعية ضد قوات العدو السعودي الإماراتي، أسفرت عن خسائر كبيرة في صفوف العدو.</p>',
      image: '/images/uploads/news21.jpg',
      category_id: 10,
      source: 'سبأ',
      is_breaking: 1,
      is_slider: 0,
      is_featured: 0,
      views: 1567,
      tags: [1, 9]
    },
    {
      title: 'منظمة الصحة العالمية: اليمن يواجه أزمة إنسانية حادة',
      summary: 'أكدت منظمة الصحة العالمية أن اليمن يواجه أزمة إنسانية حادة بسبب الحرب والحصار.',
      content: '<p>أكدت منظمة الصحة العالمية أن اليمن يواجه واحدة من أسوأ الأزمات الإنسانية في العالم، بسبب الحرب والحصار المستمر.</p><p>وأوضحت أن ملايين اليمنيين يفترون إلى الرعاية الصحية الأساسية والأدوية.</p>',
      image: '/images/uploads/news22.jpg',
      category_id: 2,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 789,
      tags: [1, 13]
    },
    {
      title: 'פסטיבל ثقافي كبير ينطلق في مدينة تعز',
      summary: 'انطلق فعاليات مهرجان ثقافي كبير في مدينة تعز بمشاركة فنانين ومثقفين من مختلف المحافظات.',
      content: '<p>انطلقت فعالياتمهرجان ثقافي كبير في مدينة تعز التاريخية بمشاركة واسعة من الفنانين والمثقفين والكتاب من مختلف المحافظات اليمنية.</p>',
      image: '/images/uploads/news23.jpg',
      category_id: 6,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 234,
      tags: [1, 6]
    },
    {
      title: ' البنك المركزي يعلن عن إجراءات جديدة لدعم الريال اليمني',
      summary: 'أعلن البنك المركزي اليمني عن إجراءات جديدة لدعم الريال اليمني ومواجهة التضخم.',
      content: '<p>أعلن البنك المרכزي اليمني عن حزمة إجراءات جديدة لدعم الريال اليمني ومواجهة التضخم المتصاعد، بما في ذلك تعزيز احتياطيات العملة الأجنبية.</p>',
      image: '/images/uploads/news24.jpg',
      category_id: 4,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 567,
      tags: [1, 11]
    },
    {
      title: 'مظاهرة حاشدة في صنعاء تضامناً مع فلسطين',
      summary: 'خرجت مظاهرة حاشدة في العاصمة صنعاء تضامناً مع الشعب الفلسطيني ورفضاً للعدوان الإسرائيلي.',
      content: '<p>خرجت مظاهرة حاشدة في ساحة التغيير بالعاصمة صنعاء تضامناً مع الشعب الفلسطيني الشقيق ورفضاً للعدوان الإسرائيلي الغاشم على قطاع غزة.</p>',
      image: '/images/uploads/news25.jpg',
      category_id: 1,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 2345,
      tags: [1]
    },
    {
      title: 'وزير النفط: نعمل على تأمين احتياجات المواطنين من المشتقات النفطية',
      summary: 'أكد وزير النفط أن الوزارة تعمل على تأمين احتياجات المواطنين من المشتقات النفطية.',
      content: '<p>أكد وزير النفط والمعادن أن الوزارة تعمل بكل جهد على تأمين احتياجات المواطنين من المشتقات النفطية رغم الحصار والحرب.</p>',
      image: '/images/uploads/news26.jpg',
      category_id: 4,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 345,
      tags: [1, 11]
    },
    {
      title: 'فوز كبير للمنتخب اليمني في تصفيات كأس العالم',
      summary: 'حقق المنتخب اليمني فوزاً كبيراً في تصفيات كأس العالم لكرة القدم.',
      content: '<p>حقق المنتخب اليمني لكرة القدم فوزاً كبيراً على نظيره المنتخب الفلبيني في تصفيات كأس العالم، مما يعزز فرصه في التأهل للدور التالي.</p>',
      image: '/images/uploads/news27.jpg',
      category_id: 5,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 1890,
      tags: [1, 12]
    },
    {
      title: 'تقرير صحفي: كيف يتعامل اليمنيون مع انقطاع الكهرباء؟',
      summary: 'تقرير صحفي يرصد كيف يتعامل اليمنيون مع أزمة انقطاع الكهرباء المستمرة.',
      content: '<p>رصد تقرير صحفي كيف يتعامل اليمنيون مع أزمة انقطاع الكهرباء المستمرة، حيث اضطر الكثيرون للبحث عن بدائل مثل الطاقة الشمسية والمولدات.</p>',
      image: '/images/uploads/news28.jpg',
      category_id: 3,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 456,
      tags: [1]
    },
    {
      title: 'إطلاق منصة رقمية جديدة لتسهيل الخدمات الحكومية',
      summary: 'أطلقت الحكومة منصة رقمية جديدة لتسهيل حصول المواطنين على الخدمات الحكومية.',
      content: '<p>أطلقت الحكومة اليمنية منصة رقمية جديدة تهدف إلى تسهيل حصول المواطنين على الخدمات الحكومية المختلفة، بما يقلل البيروقراطية ويوفر الوقت والجهد.</p>',
      image: '/images/uploads/news29.jpg',
      category_id: 15,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 345,
      tags: [1]
    },
    {
      title: 'السعودية تواصل حصارها للمنافذ اليمنية',
      summary: 'تواصل المملكة العربية السعودية حصارها للمنافذ البرية والبحرية والجوية اليمنية.',
      content: '<p>تواصل المملكة العربية السعودية فرض حصارها الخانق على اليمن من خلال إغلاق المنافذ البرية والبحرية والجوية، مما يفاقم الأزمة الإنسانية.</p>',
      image: '/images/uploads/news30.jpg',
      category_id: 10,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 876,
      tags: [1]
    },
    {
      title: 'قافلة إغاثية جديدة تصل إلى المحافظات المتضررة',
      summary: 'وصلت قافلة إغاثية جديدة تحمل مساعدات غذائية وطبية إلى المحافظات المتضررة.',
      content: '<p>وصلت قافلة إغاثية جديدة تحمل مساعدات غذائية وطبية وخيام إلى المحافظات المتضررة، وذلك في إطار الجهود المستمرة للتخفيف من معاناة المتضررين.</p>',
      image: '/images/uploads/news31.jpg',
      category_id: 12,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 234,
      tags: [1]
    },
    {
      title: 'ندوة دولية حول مستقبل اليمن تُعقد عبر الإنترنت',
      summary: 'أُقيمت ندوة دولية عبر الإنترنت لمناقشة مستقبل اليمن وسبل تحقيق السلام والاستقرار.',
      content: '<p>أُقيمت ندوة دولية عبر الإنترنت بمشاركة خبراء ومحللين من مختلف أنحاء العالم لمناقشة مستقبل اليمن وسبل تحقيق السلام والاستقرار الدائم.</p>',
      image: '/images/uploads/news32.jpg',
      category_id: 2,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 345,
      tags: [1, 10]
    },
    {
      title: 'احتفالات واسعة باليوم العالمي للطفولة في صنعاء',
      summary: 'أقيمت احتفالات واسعة بمناسبة اليوم العالمي للطفولة في العاصمة صنعاء ومختلف المحافظات.',
      content: '<p>أقيمت احتفالات واسعة بمناسبة اليوم العالمي للطفولة في العاصمة صنعاء ومختلف المحافظات اليمنية، تضمنت فعاليات ترفيهية وتعليمية للأطفال.</p>',
      image: '/images/uploads/news33.jpg',
      category_id: 7,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 234,
      tags: [1]
    },
    {
      title: 'تقرير: الفساد يهدد التنمية المستدامة في اليمن',
      summary: 'كشف تقرير جديد أن الفساد يهدد جهود التنمية المستدامة في اليمن ويعرقل إعادة البناء.',
      content: '<p>كشف تقرير صادر عن منظمة شفافية أن الفساد يشكل تهديداً خطيراً لجهود التنمية المستدامة في اليمن، ويعرقل مساعي إعادة البناء والتنمية.</p>',
      image: '/images/uploads/news34.jpg',
      category_id: 3,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 456,
      tags: [1]
    },
    {
      title: 'فتح باب التسجيل في الجامعات اليمنية للعام الدراسي الجديد',
      summary: 'أعلنت وزارة التعليم العالي عن فتح باب التسجيل في الجامعات اليمنية للعام الدراسي الجديد.',
      content: '<p>أعلنت وزارة التعليم العالي والبحث العلمي عن فتح باب التسجيل والقبول في الجامعات اليمنية للعام الدراسي الجديد 2024-2025.</p>',
      image: '/images/uploads/news35.jpg',
      category_id: 1,
      source: 'سبأ',
      is_breaking: 0,
      is_slider: 0,
      is_featured: 0,
      views: 678,
      tags: [1, 14]
    }
  ];

  const now = new Date();
  for (let i = 0; i < sampleNews.length; i++) {
    const news = sampleNews[i];
    const pubDate = new Date(now.getTime() - i * 3600000 * 2);
    const dateStr = pubDate.toISOString().slice(0, 19).replace('T', ' ');
    const slug = news.title.replace(/\s+/g, '-').substring(0, 80);
    const result = insertNews.run(
      news.title, news.summary, news.content, news.image,
      news.category_id, news.source, news.is_breaking, news.is_slider,
      news.is_featured, news.views, 1, dateStr, dateStr, slug
    );
    if (news.tags) {
      for (const tagId of news.tags) {
        insertNewsTag.run(result.lastInsertRowid, tagId);
      }
    }
  }

  // Seed breaking news
  const insertBreaking = db.prepare('INSERT INTO breaking_news (text, link, is_active, sort_order) VALUES (?, ?, ?, ?)');
  insertBreaking.run('المجلس السياسي الأعلى يعقد اجتماعاً طارئاً لمناقشة التطورات الأمنية', '/news/1', 1, 1);
  insertBreaking.run('المنتخب اليمني يتأهل إلى نهائيات كأس آسيا للمرة الأولى', '/news/4', 1, 2);
  insertBreaking.run('الجيش اليمني يصد هجوماً لقوات العدو في مأرب', '/news/18', 1, 3);
  insertBreaking.run('المقاومة اليمنية تعلن عن عملية عسكرية جديدة', '/news/21', 1, 4);

  // Seed slider
  const insertSlider = db.prepare('INSERT INTO slider (news_id, image, title, summary, link, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insertSlider.run(1, '/images/uploads/news1.jpg', 'المجلس السياسي الأعلى يعقد اجتماعاً طارئاً', 'عقد المجلس السياسي الأعلى اجتماعاً طارئاً لمناقشة آخر التطورات الأمنية والسياسية', '/news/1', 1, 1);
  insertSlider.run(4, '/images/uploads/news4.jpg', 'المنتخب اليمني يتأهل إلى نهائيات كأس آسيا', 'حقق المنتخب اليمني لكرة القدم إنجازاً تاريخياً بالتأهل إلى نهائيات كأس آسيا', '/news/4', 2, 1);
  insertSlider.run(5, '/images/uploads/news5.jpg', 'قائد الثورة يلقي كلمة بمناسبة ذكرى 21 سبتمبر', 'ألقى قائد الثورة السيد عبد الملك الحوثي كلمة بمناسبة الذكرى السنوية لثورة 21 سبتمبر', '/news/5', 3, 1);
  insertSlider.run(2, '/images/uploads/news2.jpg', 'اليمن تؤكد دعمها للقضية الفلسطينية', 'أكد وزير الخارجية أن اليمن تدعم القضية الفلسطينية', '/news/2', 4, 1);
  insertSlider.run(7, '/images/uploads/news7.jpg', 'حصيلة جرائم العدوان الأمريكي السعودي', 'أصدر المركز اليمني لحقوق الإنسان تقريراً يوثق حصيلة جرائم العدوان', '/news/7', 5, 1);

  // Seed media
  const insertMedia = db.prepare('INSERT INTO media (type, title, file_path, thumbnail, description, category) VALUES (?, ?, ?, ?, ?, ?)');
  insertMedia.run('video', 'تقرير ميداني: معاناة أهالي الحديدة', '/images/uploads/vid1.jpg', '/images/uploads/vid1_thumb.jpg', 'تقرير ميداني عن معاناة أهالي محافظة الحديدة', 'تقارير');
  insertMedia.run('video', 'لحظة استهداف مصنع في صنعاء', '/images/uploads/vid2.jpg', '/images/uploads/vid2_thumb.jpg', 'لحظة استهداف مصنع في صنعاء بالطائرات الحربية', 'عدوان');
  insertMedia.run('image', 'معرض صور: صنعاء القديمة', '/images/uploads/gal1.jpg', '/images/uploads/gal1_thumb.jpg', 'مجموعة صور من صنعاء القديمة', 'ثقافة');
  insertMedia.run('image', 'معرض صور: جزيرة سقطرى', '/images/uploads/gal2.jpg', '/images/uploads/gal2_thumb.jpg', 'مجموعة صور من جزيرة سقطرى الطبيعية', 'سياحة');
  insertMedia.run('audio', 'خطاب قائد الثورة - 21 سبتمبر', '/images/uploads/aud1.mp3', null, 'خطاب قائد الثورة بمناسبة ذكرى 21 سبتمبر', 'خطابات');

  // Seed polls
  const insertPoll = db.prepare('INSERT INTO polls (question, is_active, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  const insertPollOption = db.prepare('INSERT INTO poll_options (poll_id, option_text, votes) VALUES (?, ?, ?)');

  const poll1 = insertPoll.run('ما رأيك في الأداء الحكومي خلال الفترة الماضية؟', 1);
  insertPollOption.run(poll1.lastInsertRowid, 'ممتاز', 45);
  insertPollOption.run(poll1.lastInsertRowid, 'جيد', 120);
  insertPollOption.run(poll1.lastInsertRowid, 'متوسط', 85);
  insertPollOption.run(poll1.lastInsertRowid, 'ضعيف', 30);

  const poll2 = insertPoll.run('هل تؤيد استمرار المفاوضات السلام؟', 1);
  insertPollOption.run(poll2.lastInsertRowid, 'نعم بالتأكيد', 200);
  insertPollOption.run(poll2.lastInsertRowid, 'نعم بشروط', 150);
  insertPollOption.run(poll2.lastInsertRowid, 'لا أؤيد', 40);
  insertPollOption.run(poll2.lastInsertRowid, 'غير مهتم', 15);

  const poll3 = insertPoll.run('ما القطاع الأكثر أهمية للتنمية؟', 1);
  insertPollOption.run(poll3.lastInsertRowid, 'التعليم', 180);
  insertPollOption.run(poll3.lastInsertRowid, 'الصحة', 160);
  insertPollOption.run(poll3.lastInsertRowid, 'البنية التحتية', 90);
  insertPollOption.run(poll3.lastInsertRowid, 'الزراعة', 70);

  // Seed comments
  const insertComment = db.prepare('INSERT INTO comments (news_id, author_name, content, status, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)');
  insertComment.run(1, 'أحمد محمد', 'خبر مهم جداً، نتمنى التوفيق للقيادة', 1);
  insertComment.run(1, 'فاطمة علي', 'اللهم وفقهم لما فيه خير البلاد', 1);
  insertComment.run(4, 'خالد عبدالله', 'فوز تاريخي للمنتخب، مبروك لجميع اليمنيين', 1);
  insertComment.run(4, 'مريم حسين', 'إنجاز رائع، نتمنى مزيداً من النجاحات', 1);
  insertComment.run(7, 'يوسف أحمد', 'ندعو الله أن يحفظ اليمن من كل سوء', 1);
  insertComment.run(2, 'سارة محمود', 'اليمن دائماً مع الحق والعدالة', 0);
  insertComment.run(5, 'عمر حسن', 'خطاب ملهم من القائد', 1);

  // Seed newsletter subscribers
  const insertSubscriber = db.prepare('INSERT INTO newsletter_subscribers (email, name, is_active) VALUES (?, ?, ?)');
  insertSubscriber.run('ahmed@example.com', 'أحمد محمد', 1);
  insertSubscriber.run('fatima@example.com', 'فاطمة علي', 1);
  insertSubscriber.run('khalid@example.com', 'خالد عبدالله', 1);
  insertSubscriber.run('maryam@example.com', 'مريم حسين', 1);

  console.log('Database seeded successfully!');
}

module.exports = { getDb, initDatabase };
