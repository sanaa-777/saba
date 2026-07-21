# Awtar - أوتر

Complete news website built with Node.js, Express, PostgreSQL/Supabase, and EJS templates. Uses Supabase PostgreSQL as the application database in deployment.

## Features

- **Homepage**: Breaking news ticker, main slider, category sections, sidebar
- **Categories**: 15 news categories with pagination
- **Articles**: Full article view with social sharing, related articles, tags
- **Search**: Advanced search with filters (category, date range, scope)
- **Media**: Videos, photo galleries, audio library, caricatures, publications
- **Admin Panel**: Full CRUD for news, categories, tags, media, slider, breaking news, ads, settings
- **RSS Feed**: `/rss`
- **Sitemap**: `/sitemap.xml`
- **Robots.txt**: `/robots.txt`
- **PWA**: Service worker with cache support
- **SEO**: Meta tags, Open Graph, JSON-LD structured data
- **Responsive**: Mobile-first design with RTL Arabic support

## Tech Stack

- **Backend**: Node.js + Express.js
- **Database**: PostgreSQL (Supabase)
- **Templates**: EJS (server-side rendering)
- **Auth**: express-session + bcryptjs
- **Uploads**: Multer
- **RSS**: rss package

## Quick Start

```bash
# Install dependencies
npm install

# Start the server (auto-initializes DB with seed data)
npm start
```

The server starts at `http://localhost:3000`

### Environment

Production deploys should define:

```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.your-project-ref.supabase.co:5432/postgres?sslmode=require
PG_POOL_MAX=4
SESSION_SECRET=replace-with-random-secret
```

The application expects `DATABASE_URL` to point to your Supabase PostgreSQL instance.

## Admin Panel

Access: `http://localhost:3000/admin`

**Default credentials:**
- Username: `admin`
- Password: `admin123`

## Project Structure

```
awtar/
├── app.js              # Express app setup
├── start.js            # Entry point (init DB + start server)
├── package.json
├── db/
│   ├── init.js         # DB adapter selector
│   ├── postgres-init.js # PostgreSQL/Supabase compatibility layer
├── middleware/
│   └── auth.js         # Admin auth middleware
├── routes/
│   ├── public.js       # Public routes
│   └── admin.js        # Admin routes
├── views/
│   ├── partials/       # head, header, footer, sidebar
│   ├── admin/          # Admin panel views
│   ├── media/          # Media pages (videos, galleries, etc.)
│   ├── news/           # Article page
│   ├── index.ejs       # Homepage
│   ├── category.ejs    # Category listing
│   ├── search.ejs      # Search page
│   ├── tag.ejs         # Tag page
│   ├── archive.ejs     # Archive page
│   ├── 404.ejs         # 404 page
│   └── error.ejs       # Error page
├── public/
│   ├── css/            # style.css, responsive.css, slider.css, admin.css
│   ├── js/             # main.js
│   ├── images/         # Static images
│   ├── sw.js           # Service worker (PWA)
│   └── manifest.json   # PWA manifest
```

## Routes

### Public
| Route | Description |
|-------|-------------|
| `/` | Homepage |
| `/category/:id` | Category page |
| `/news/:id` | Article page |
| `/search` | Advanced search |
| `/videos` | Video library |
| `/galleries` | Photo galleries |
| `/gallery/:id` | Gallery detail |
| `/audios` | Audio library |
| `/caricatures` | Caricatures |
| `/publications` | Publications |
| `/files` | News files |
| `/tag/:slug` | News by tag |
| `/archive/:date` | Archive by date |
| `/rss` | RSS feed |
| `/sitemap.xml` | XML sitemap |
| `/robots.txt` | Robots.txt |

### Admin
| Route | Description |
|-------|-------------|
| `/admin/login` | Login |
| `/admin` | Dashboard |
| `/admin/news` | News management |
| `/admin/news/create` | Add news |
| `/admin/news/edit/:id` | Edit news |
| `/admin/categories` | Categories |
| `/admin/tags` | Tags |
| `/admin/media` | Media manager |
| `/admin/breaking` | Breaking news |
| `/admin/slider` | Slider |
| `/admin/ads` | Advertisements |
| `/admin/settings` | Site settings |
| `/admin/profile` | Admin profile |

## Database

PostgreSQL/Supabase schema includes the following tables:
- `categories` - News categories
- `news` - News articles
- `tags` - Article tags
- `news_tags` - Many-to-many relation
- `media` - Media files
- `breaking_news` - Breaking news items
- `slider` - Slider entries
- `advertisements` - Ads
- `admin_users` - Admin accounts
- `settings` - Site settings

## Seed Data

The database auto-seeds with:
- 15 categories
- 15 tags
- 35 sample news articles
- 5 slider entries
- 4 breaking news items
- 5 media entries
- 1 admin user (admin/admin123)
- 16 site settings

## License

MIT
