import bcrypt from "npm:bcryptjs";
import Parser from "npm:rss-parser";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://uwyjpykfpyusnbvtrfjh.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const API = `${SUPABASE_URL}/rest/v1`;
const TOKEN_SECRET = SERVICE_KEY || ANON_KEY;
const parser = new Parser({ timeout: 18000, headers: { "User-Agent": "AwtarNewsBot/2.0" } });
const cors = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-cron-secret", "Access-Control-Allow-Methods":"GET,POST,PATCH,DELETE,OPTIONS", "Content-Type":"application/json; charset=utf-8" };
function json(data: unknown, status=200, headers: Record<string,string>={}) { return new Response(JSON.stringify(data), {status,headers:{...cors,...headers}}); }
function b64(input: Uint8Array|string) { const b=typeof input==='string'?new TextEncoder().encode(input):input; return btoa(String.fromCharCode(...b)).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); }
function unb64(input:string) { return atob(input.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-input.length%4)%4)); }
async function sign(v:string) { const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(TOKEN_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']); return b64(new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(v)))); }
async function makeToken(a:any) { const p=b64(JSON.stringify({id:a.id,username:a.username,role:a.role,exp:Date.now()+86400000})); return `${p}.${await sign(p)}`; }
async function auth(req:Request) { const raw=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||''; const [p,s]=raw.split('.'); if(!p||!s||s!==await sign(p)) return null; try { const d=JSON.parse(unb64(p)); return d.exp>Date.now()?d:null; } catch { return null; } }
function serviceAuth(req:Request) { const raw=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||''; return !!SERVICE_KEY && raw===SERVICE_KEY; }
async function db(path:string, init:RequestInit={}) { const key=SERVICE_KEY||ANON_KEY; const r=await fetch(`${API}${path}`,{...init,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(init.headers||{})}}); const text=await r.text(); let data:any; try{data=text?JSON.parse(text):null}catch{data=text} if(!r.ok) throw new Error(data?.message||data?.hint||`Database error ${r.status}`); return data; }
function enc(v:any){return encodeURIComponent(String(v??''));}
function validImage(v:any){return typeof v==='string'&&/^https?:\/\//i.test(v)&&v.length<2000;}
function abs(v:string,base:string){try{return new URL(v,base).href}catch{return v}}
function text(v:any){return String(v??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()}
async function fetchImage(url:string){ const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; AwtarNews/2.0)','Accept':'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'},redirect:'follow'}); if(!r.ok) throw new Error(`image ${r.status}`); const ct=r.headers.get('content-type')||'image/jpeg'; if(!ct.startsWith('image/')) throw new Error('not image'); return new Response(r.body,{status:200,headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'public,max-age=86400','Content-Type':ct}}); }
function sourceType(s:any){const u=String(s.url||'').toLowerCase(); if(u.includes('t.me/')||u.includes('telegram')) return 'telegram'; if(u.includes('rss')||u.includes('feed')||u.includes('.xml')||u.includes('atom')) return 'rss'; return 'website';}
async function fetchSource(source:any){ const type=sourceType(source); if(type==='telegram'){ const m=String(source.url).match(/t\.me\/(?:s\/)?([\w]+)/); if(!m) return []; const r=await fetch(`https://t.me/s/${m[1]}`,{headers:{'User-Agent':'Mozilla/5.0'}}); const h=await r.text(); const out:any[]=[]; for(const part of h.split('tgme_widget_message_wrap').slice(1)){const clean=text(part); if(clean.length<30) continue; const title=clean.slice(0,150); out.push({title,summary:clean.slice(0,500),content:clean,source_url:`https://t.me/${m[1]}`,image:null,published_at:new Date().toISOString()});} return out.slice(0,30); }
 const r=await fetch(String(source.url),{headers:{'User-Agent':'Mozilla/5.0 (compatible; AwtarNewsBot/2.0)','Accept':'application/rss+xml, application/atom+xml, text/xml, text/html,*/*'},redirect:'follow'}); const raw=await r.text(); let feed:any; try{feed=await parser.parseString(raw)}catch{feed=null} if(feed?.items?.length){return feed.items.slice(0,30).map((i:any)=>{const html=String(i['content:encoded']||i.content||i.description||''); const im=i.enclosure?.url||i.mediaContent?.url||i.mediaThumbnail?.url||(html.match(/<img[^>]+src=["']([^"']+)/i)?.[1]||null); return {title:text(i.title),summary:text(i.contentSnippet||i.description).slice(0,700),content:html||text(i.contentSnippet||i.description),source_url:i.link||null,image:im&&validImage(abs(im,i.link||source.url))?abs(im,i.link||source.url):null,published_at:i.isoDate||i.pubDate||new Date().toISOString()};});}
 const images=[...raw.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']+)/gi)].map(m=>abs(m[1],source.url)); const titles=[...raw.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map(m=>text(m[1])).filter(x=>x.length>12); return titles.slice(0,20).map((t,i)=>({title:t,summary:t,content:t,source_url:source.url,image:validImage(images[i])?images[i]:null,published_at:new Date().toISOString()})); }
function extractBlock(html:string, pattern:RegExp){
 const at=html.search(pattern); if(at<0)return '';
 const open=html.slice(at).match(/^<([a-z0-9]+)\b[^>]*>/i); if(!open)return '';
 const tag=open[1].toLowerCase(), bodyStart=at+open[0].length;
 const tags=new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'); tags.lastIndex=bodyStart;
 let depth=1, m:any; while((m=tags.exec(html))){if(new RegExp(`^<${tag}\\b`,'i').test(m[0]))depth++;else depth--;if(depth===0)return html.slice(bodyStart,m.index);}
 return html.slice(bodyStart);
}
function cleanArticle(raw:string){
 return raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<iframe[\s\S]*?<\/iframe>|<noscript[\s\S]*?<\/noscript>/gi,'')
  .replace(/\s+(?:onclick|onload|onerror|style)=(["'])[^"']*\1/gi,'').trim();
}
async function fetchArticleDetail(url:string){
 try{
  const r=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{'User-Agent':'Mozilla/5.0 (compatible; AwtarNewsBot/2.1; +https://awter-news.web.app)','Accept':'text/html,application/xhtml+xml'}});
  if(!r.ok)return null; const h=await r.text();
  const selectors=[
   /<[^>]+itemprop=["']articleBody["'][^>]*>/i,
   /<(?:article|main)[^>]+class=["'][^"']*(?:article|post|entry|story|news)[^"']*(?:content|body|text)?[^"']*["'][^>]*>/i,
   /<div[^>]+class=["'][^"']*(?:entry-content|post-content|article-content|article-body|single-post-content|td-post-content|story-content|news-content|post-body)[^"']*["'][^>]*>/i,
   /<article\b[^>]*>/i
  ];
  const candidates:string[]=[];
  for(const p of selectors){const b=extractBlock(h,p); if(b)candidates.push(cleanArticle(b));}
  const textBest=candidates.filter(x=>text(x).length>=300).sort((a,b)=>text(b).length-text(a).length)[0];
  if(textBest)return textBest.slice(0,120000);
  const imageOnly=candidates.find(x=>/<img\b/i.test(x));
  if(imageOnly)return imageOnly.slice(0,120000);
  const desc=(h.match(/<meta[^>]+(?:name|property)=[\"'](?:description|og:description)[\"'][^>]+content=[\"']([^\"']+)/i)||[])[1]||'';
  const og=(h.match(/<meta[^>]+property=[\"']og:image[\"'][^>]+content=[\"']([^\"']+)/i)||[])[1]||'';
  if(desc||og)return `${desc?`<p>${desc}</p>`:''}${og?`<p><img src=\"${og}\" alt=\"صورة المقال\" /></p>`:''}`;
  return null;
 }catch{return null}
}
function catFor(a:any,cats:any[]){const s=`${a.title} ${a.summary}`.toLowerCase(); const rules:[number,string[]][]=[[16,['عاجل','breaking','urgent']],[5,['رياضة','football','sport','مباراة']],[4,['اقتصاد','نفط','سعر','دولار','ذهب']],[6,['ثقافة','فن','رواية']],[1,['اليمن','صنعاء','عدن','تعز','مأرب']],[2,['غزة','فلسطين','إيران','أمريكا','سوريا','دولي']]]; for(const [id,words] of rules) if(words.some(w=>s.includes(w))) return id; return cats.find((c:any)=>c.slug==='misc')?.id||7; }
async function saveArticles(source:any,articles:any[]){let cats:any[]=[];try{cats=await db('/categories?select=id,slug,name_ar')}catch{}; let inserted=0; for(const a of articles){if(!a.title||a.title.length<5)continue; const exists=await db(`/news?select=id&or=(title.eq.${enc(a.title)},source_url.eq.${enc(a.source_url||'')})&limit=1`).catch(()=>[]); if(exists?.length)continue; const row={title:a.title.slice(0,500),summary:(a.summary||a.content||'').slice(0,1000),content:a.content||a.summary||'',image:validImage(a.image)?a.image:null,category_id:source.category_id||catFor(a,cats),source:source.name,status:source.auto_publish?1:0,is_breaking:0,is_slider:0,is_featured:0,published_at:a.published_at||new Date().toISOString(),source_url:a.source_url||null,slug:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`}; try{await db('/news',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});inserted++}catch{} } return inserted; }
async function fetchAll(offset=0,limit=12){ const all=await db('/news_sources?select=*&is_active=eq.1&order=id.asc'); const sources=all.slice(offset,offset+limit); let total=0,errors=0; for(let i=0;i<sources.length;i+=3){const batch=sources.slice(i,i+3); const results=await Promise.all(batch.map(async(s:any)=>{try{return await saveArticles(s,await fetchSource(s))}catch{return errors++,0}})); total+=results.reduce((a,b)=>a+b,0); } return {totalNew:total,errors,sources:sources.length,offset,nextOffset:offset+sources.length,complete:offset+sources.length>=all.length,totalSources:all.length}; }
async function table(name:string,query:string, fallback:any[]=[]){try{return await db(`/${name}?${query}`)}catch{return fallback;}}

Deno.serve(async(req)=>{ if(req.method==='OPTIONS')return new Response('ok',{headers:cors}); const u=new URL(req.url); const path=u.pathname.replace(/^\/functions\/v1\/awtar-api/,'').replace(/^\/awtar-api/,'')||'/'; try{
 if(path==='/'&&req.method==='GET')return json({ok:true,service:'awtar-api',version:'2.0'});
 if(path==='/image'&&req.method==='GET'){const target=u.searchParams.get('url');if(!target||!/^https?:/i.test(target))return json({error:'invalid image'},400);try{return await fetchImage(target)}catch{return new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675"><defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#0f3b82"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient></defs><rect width="1200" height="675" fill="url(#g)"/><circle cx="600" cy="285" r="86" fill="#fff" opacity=".16"/><path d="M530 330l55-62 45 46 35-40 70 80H530z" fill="#fff" opacity=".8"/><text x="600" y="485" text-anchor="middle" fill="#fff" font-family="Arial" font-size="38">أوتر نيوز</text></svg>`,{status:200,headers:{...cors,'Content-Type':'image/svg+xml','Cache-Control':'public,max-age=300'}})}}
 if(path==='/categories'&&req.method==='GET')return json(await db('/categories?select=*&is_active=eq.1&order=sort_order.asc'));
 if(path==='/tags'&&req.method==='GET')return json(await table('tags','select=*&order=name_ar.asc'));
 if(path==='/settings'&&req.method==='GET')return json(await db('/settings?select=key,value'));
 if(path==='/news'&&req.method==='GET'){const limit=Math.min(Number(u.searchParams.get('limit')||30),100);const q=u.searchParams.get('q');const category=u.searchParams.get('category');let f=`select=*&status=eq.1&deleted_at=is.null&order=published_at.desc.nullslast,created_at.desc&limit=${limit}`;if(q)f+=`&or=(title.ilike.*${enc(q)}*,summary.ilike.*${enc(q)}*)`;if(category)f+=`&category_id=eq.${enc(category)}`;return json(await db(`/news?${f}`));}
 const nm=path.match(/^\/news\/(\d+)$/);if(nm&&req.method==='GET'){const rows=await db(`/news?id=eq.${nm[1]}&status=eq.1&select=*`);const n=rows[0];if(n&&String(n.content||'').replace(/<[^>]*>/g,'').length<700&&n.source_url){const detail=await fetchArticleDetail(n.source_url);if(detail){n.content=detail;await db(`/news?id=eq.${n.id}`,{method:'PATCH',body:JSON.stringify({content:detail})}).catch(()=>{});}}return json(n||null)}
 const rel=path.match(/^\/news\/(\d+)\/related$/);if(rel&&req.method==='GET'){const current=(await db(`/news?id=eq.${rel[1]}&select=category_id`))[0];return json(current?.category_id?await db(`/news?category_id=eq.${current.category_id}&id=neq.${rel[1]}&status=eq.1&deleted_at=is.null&select=*&order=published_at.desc&limit=6`):[])}
 if(path==='/breaking'&&req.method==='GET')return json(await table('breaking_news','select=*&is_active=eq.1&order=created_at.desc'));
 if(path==='/slider'&&req.method==='GET')return json(await table('sliders','select=*&is_active=eq.1&order=sort_order.asc'));
 if(path==='/media'&&req.method==='GET'){const type=u.searchParams.get('type');return json(await table('media',`select=*&${type?`type=eq.${enc(type)}&`:''}order=created_at.desc&limit=100`));}
 if(path==='/ads'&&req.method==='GET')return json(await table('ads','select=*&is_active=eq.1&order=sort_order.asc,created_at.desc'));
 if(path.match(/^\/comments\/\d+$/)&&req.method==='GET')return json(await table('comments',`news_id=eq.${path.split('/').pop()}&status=eq.1&order=created_at.asc`));
 if(path==='/comments'&&req.method==='POST'){const b=await req.json();if(!b.news_id||!b.author_name||!b.content)return json({success:false,message:'الاسم والتعليق مطلوبان'},400);await db('/comments',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({news_id:Number(b.news_id),author_name:String(b.author_name).slice(0,120),author_email:b.author_email||null,content:String(b.content).slice(0,4000),status:0})});return json({success:true,message:'تم إرسال التعليق للمراجعة'});}
 if(path==='/polls/active'&&req.method==='GET')return json(await table('polls','is_active=eq.1&select=*,poll_options(*)&limit=1'));
 if(path==='/polls/vote'&&req.method==='POST'){const b=await req.json();const rows=await db(`/poll_options?id=eq.${Number(b.option_id)}&poll_id=eq.${Number(b.poll_id)}&select=id,votes`);if(!rows.length)return json({success:false,message:'الخيار غير موجود'},400);const votes=(rows[0].votes||0)+1;await db(`/poll_options?id=eq.${rows[0].id}`,{method:'PATCH',body:JSON.stringify({votes})});const options=await db(`/poll_options?poll_id=eq.${Number(b.poll_id)}&select=id,votes,option_text`);return json({success:true,options,totalVotes:options.reduce((s:any,x:any)=>s+(x.votes||0),0)});}
 if(path==='/newsletter/subscribe'&&req.method==='POST'){const b=await req.json();if(!b.email)return json({error:'البريد الإلكتروني مطلوب'},400);await db('/newsletter_subscribers',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({email:b.email,name:b.name||null,is_active:1})});return json({success:true,message:'تم الاشتراك بنجاح'});}
 if(path==='/cron/fetch-news'&&req.method==='GET'){if(!serviceAuth(req)&&req.headers.get('x-cron-secret')!==Deno.env.get('CRON_SECRET'))return json({error:'غير مصرح'},401);return json(await fetchAll(Number(u.searchParams.get('offset')||0),Math.min(Number(u.searchParams.get('limit')||12),20)));}
 if(path==='/auth/login'&&req.method==='POST'){const b=await req.json();const rows=await db(`/admin_users?username=eq.${enc(b.username||'')}&select=id,username,password,name,role&limit=1`);const a=rows[0];if(!a||!(await bcrypt.compare(b.password||'',a.password)))return json({error:'بيانات الدخول غير صحيحة'},401);delete a.password;return json({token:await makeToken(a),admin:a});}
 const a=await auth(req);if(!a)return json({error:'غير مصرح'},401);
 if(path==='/admin/me'&&req.method==='GET')return json({admin:a});
 if(path==='/admin/overview'&&req.method==='GET'){const [news,sources,comments,subs]=await Promise.all([table('news','select=id&deleted_at=is.null'),table('news_sources','select=id&is_active=eq.1'),table('comments','select=id&status=eq.0'),table('newsletter_subscribers','select=id&is_active=eq.1')]);return json({news:news.length,sources:sources.length,pendingComments:comments.length,subscribers:subs.length});}
 if(path==='/admin/news'&&req.method==='GET')return json(await db('/news?select=*&order=created_at.desc&limit=200'));
 if(path==='/admin/news'&&req.method==='POST')return json(await db('/news',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(await req.json())}),201);
 if(path==='/admin/trash'&&req.method==='GET')return json(await db('/news?select=*&deleted_at=not.is.null&order=deleted_at.desc&limit=200'));
 if(path==='/admin/profile'&&req.method==='GET')return json({admin:a});
 const an=path.match(/^\/admin\/news\/(\d+)$/);if(an&&req.method==='PATCH')return json(await db(`/news?id=eq.${an[1]}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(await req.json())}));if(an&&req.method==='DELETE')return json(await db(`/news?id=eq.${an[1]}`,{method:'PATCH',body:JSON.stringify({deleted_at:new Date().toISOString(),status:0})}));
 if(path==='/admin/sources'&&req.method==='GET')return json(await db('/news_sources?select=*&order=id.asc'));
 if(path==='/admin/sources'&&req.method==='POST')return json(await db('/news_sources',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(await req.json())}),201);
 const as=path.match(/^\/admin\/sources\/(\d+)$/);if(as&&req.method==='PATCH')return json(await db(`/news_sources?id=eq.${as[1]}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(await req.json())}));if(as&&req.method==='DELETE')return json(await db(`/news_sources?id=eq.${as[1]}`,{method:'DELETE'}));
 if(path==='/admin/sources/fetch-all'&&req.method==='POST')return json(await fetchAll(Number(u.searchParams.get('offset')||0),Math.min(Number(u.searchParams.get('limit')||12),20)));
 const one=path.match(/^\/admin\/sources\/(\d+)\/fetch$/);if(one&&req.method==='POST'){const s=(await db(`/news_sources?id=eq.${one[1]}&select=*`))[0];return json({totalNew:await saveArticles(s,await fetchSource(s))});}
 if(path==='/admin/categories'&&req.method==='GET')return json(await db('/categories?select=*&order=sort_order.asc'));
 if(path==='/admin/categories'&&req.method==='POST')return json(await db('/categories',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(await req.json())}),201);
 if(path==='/admin/tags'&&req.method==='GET')return json(await table('tags','select=*&order=id.desc'));
 if(path==='/admin/settings'&&req.method==='GET')return json(await db('/settings?select=*'));
 if(path==='/admin/settings'&&req.method==='PATCH'){const b=await req.json();return json(await db('/settings?key=eq.'+enc(b.key),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({value:b.value})}));}
 if(path==='/admin/comments'&&req.method==='GET')return json(await table('comments','select=*&order=created_at.desc'));
 if(path==='/admin/polls'&&req.method==='GET')return json(await table('polls','select=*,poll_options(*)&order=created_at.desc'));
 if(path==='/admin/polls'&&req.method==='POST'){const b=await req.json();const question=String(b.question||'').trim();const options=Array.isArray(b.options)?b.options.map((x:any)=>String(x).trim()).filter(Boolean).slice(0,8):[];if(!question||options.length<2)return json({error:'السؤال وخياران مطلوبان'},400);const created=await db('/polls',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({question,is_active:b.is_active===0?0:1})});const poll=created?.[0];for(const option_text of options)await db('/poll_options',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({poll_id:poll.id,option_text,votes:0})});return json(poll,201);}
 const ap=path.match(/^\/admin\/polls\/(\d+)$/);if(ap&&req.method==='DELETE'){await db(`/poll_options?poll_id=eq.${ap[1]}`,{method:'DELETE'});return json(await db(`/polls?id=eq.${ap[1]}`,{method:'DELETE'}));}
 if(path==='/admin/newsletter'&&req.method==='GET')return json(await table('newsletter_subscribers','select=*&order=created_at.desc'));
 if(path==='/admin/audit-log'&&req.method==='GET')return json(await table('audit_logs','select=*&order=created_at.desc&limit=100'));
 if(path==='/admin/action'&&req.method==='POST'){const b=await req.json();const allowed:any={comments:'comments',polls:'polls',newsletter:'newsletter_subscribers',ads:'ads',sliders:'sliders'};const tableName=allowed[b.table];if(!tableName||!Number.isFinite(Number(b.id)))return json({error:'عملية غير صالحة'},400);const patch=b.patch&&typeof b.patch==='object'?b.patch:{};return json(await db(`/${tableName}?id=eq.${Number(b.id)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)}));}
 return json({error:'Not found'},404);
 }catch(e){return json({error:e instanceof Error?e.message:'Server error'},500)} });
