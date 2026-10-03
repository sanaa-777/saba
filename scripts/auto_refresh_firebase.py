import hashlib, html, json, mimetypes, re, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'firebase-dist/data/news-fallback.json'
# This script lives in scripts/ and writes the static Firebase Hosting payload.
DATA.parent.mkdir(parents=True, exist_ok=True)
IMG_DIR=ROOT/'firebase-dist/images/news'; IMG_DIR.mkdir(parents=True,exist_ok=True)
UA='Mozilla/5.0 (compatible; AwtarNewsAuto/1.0; +https://awter-news.web.app)'
FEEDS=[('بي بي سي عربي','https://feeds.bbci.co.uk/arabic/rss.xml',1),('سكاي نيوز عربية','https://www.skynewsarabia.com/web/rss',2)]

def request(url, accept='*/*', binary=False):
    req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':accept})
    with urllib.request.urlopen(req,timeout=20) as r:
        data=r.read()
    return data if binary else data.decode('utf-8','ignore')

def clean_text(s): return re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',s or ''))).strip()
def rid(link): return 910000 + (int(hashlib.sha1(link.encode()).hexdigest()[:8],16)%80000)
def date(raw):
    try: return parsedate_to_datetime(raw).astimezone(timezone.utc).isoformat()
    except Exception: return datetime.now(timezone.utc).isoformat()

def parse_feed(source,url,cat):
    root=BeautifulSoup(request(url,'application/rss+xml,application/xml,text/xml'),'xml')
    out=[]
    for item in root.find_all('item')[:50]:
        title=clean_text(item.find('title').get_text() if item.find('title') else '')
        link=(item.find('link').get_text(strip=True) if item.find('link') else '')
        if not title or not link: continue
        desc=clean_text(item.find('description').get_text() if item.find('description') else '')
        image=None
        for tag in item.find_all():
            if tag.name in ('enclosure','media:content','media:thumbnail','content'):
                image=tag.get('url') or tag.get('href')
                if image: break
        out.append({'id':rid(link),'title':title,'summary':desc[:900],'content':f'<p>{html.escape(desc)}</p>' if desc else '', 'image':image,'category_id':cat,'source':source,'is_breaking':0,'is_slider':0,'is_featured':0,'views':0,'status':1,'published_at':date(item.find('pubDate').get_text() if item.find('pubDate') else ''),'created_at':date(item.find('pubDate').get_text() if item.find('pubDate') else ''),'slug':f'rss-{rid(link)}','source_url':link})
    return out

def extract_article(raw):
    soup=BeautifulSoup(raw,'lxml')
    for x in soup.select('script,style,nav,header,footer,aside,form,iframe,video,figure figcaption,.ad,.ads,.advert,.advertisement,[class*=related],[class*=recommend],[class*=share],[class*=social],[class*=sidebar],[class*=comment],[class*=newsletter],[class*=banner]'): x.decompose()
    best=[]
    for sel in ('[itemprop="articleBody"]','.article-body','.article-content','.entry-content','.post-content','.story-content','article','main'):
        for node in soup.select(sel):
            ps=[]
            for p in node.select('p'):
                t=clean_text(p.get_text(' ',strip=True))
                if len(t)>=35 and not re.match(r'^(اقرأ|إقرأ|شاهد|تابع|المصدر|مصدر)',t): ps.append(t)
            if sum(map(len,ps))>sum(map(len,best)): best=ps
    return ''.join(f'<p>{html.escape(x)}</p>' for x in best[:100]) if sum(map(len,best))>=280 else ''

def enrich(row):
    key=hashlib.sha1((row.get('source_url') or str(row['id'])).encode()).hexdigest()[:16]
    try:
        page=request(row['source_url'],'text/html,application/xhtml+xml')
        body=extract_article(page)
        if body: row['content']=body
        if not row.get('image'):
            soup=BeautifulSoup(page,'lxml')
            m=soup.find('meta',attrs={'property':'og:image'}) or soup.find('meta',attrs={'name':'twitter:image'})
            if m: row['image']=m.get('content')
    except Exception: pass
    if row.get('image','').startswith('http'):
        try:
            data=request(row['image'],'image/avif,image/webp,image/jpeg,image/png,*/*',True)
            if len(data)>1500:
                ext=Path(urllib.parse.urlparse(row['image']).path).suffix.lower()
                if ext not in ('.jpg','.jpeg','.png','.webp','.gif'): ext='.jpg'
                p=IMG_DIR/f'auto-{key}{ext}'; p.write_bytes(data); row['image']=f'/images/news/{p.name}'
        except Exception: pass
    return row

fresh=[]
for source,url,cat in FEEDS:
    try:
        fresh.extend(parse_feed(source,url,cat)); print(source,'ok')
    except Exception as e: print(source,'failed',e)
old=json.loads(DATA.read_text(encoding='utf-8')) if DATA.exists() else []
by_link={x.get('source_url'):x for x in old if x.get('source_url')}
for row in fresh:
    prev=by_link.get(row['source_url'])
    if prev:
        row['id']=prev.get('id',row['id']); row['slug']=prev.get('slug',row['slug'])
with ThreadPoolExecutor(max_workers=10) as pool:
    fresh=[f.result() for f in as_completed([pool.submit(enrich,r) for r in fresh])]
seen=set(); merged=[]
for row in sorted(fresh+old,key=lambda x:x.get('published_at') or '',reverse=True):
    k=row.get('source_url') or row.get('title')
    if k and k not in seen: merged.append(row); seen.add(k)
merged=merged[:180]
DATA.write_text(json.dumps(merged,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print('fresh',len(fresh),'total',len(merged),'newest',merged[0].get('published_at'),merged[0].get('title'))
