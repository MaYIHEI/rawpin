/**
 * rawpin - icon pipeline for paperclip/pin
 *
 * Endpoints:
 *   GET /api/search-app?term=...&country=cn
 *     -> iTunes Search API proxy, returns app icons (artworkUrl512 + artworkUrl100)
 *
 *   GET /api/weapp-info?appid=wx...
 *     -> WeChat mini-program plugin profile scrape (logo + name)
 *
 *   GET /img?url=<encoded image url>
 *     -> generic image proxy with CORS (so canvas can read it)
 *
 *   Everything else falls through to static assets (index.html).
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
    const { request, next } = context;
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS });
    }

    if (url.pathname === '/api/search-app') return handleSearchApp(url);
    if (url.pathname === '/api/weapp-info') return handleWeappInfo(url);
    if (url.pathname === '/img')            return handleImg(url);

    return next();
}

// ---------------- WeChat Mini-Program ----------------

const APPID_RE = /^wx[a-f0-9]{16}$/i;

async function handleWeappInfo(url) {
    const raw = (url.searchParams.get('appid') || '').trim();
    const m = raw.match(/wx[a-f0-9]{16}/i);
    if (!m) return json({ ok: false, error: 'invalid appid format' }, 400);
    const appid = m[0].toLowerCase();

    const target = `https://mp.weixin.qq.com/wxopen/pluginbasicprofile?action=intro&appid=${appid}&token=&lang=zh_CN`;
    let html;
    try {
        const resp = await fetch(target, {
            headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
            cf: { cacheTtl: 300, cacheEverything: true },
        });
        if (!resp.ok) return json({ ok: false, error: `upstream ${resp.status}`, appid }, 502);
        html = await resp.text();
    } catch {
        return json({ ok: false, error: 'fetch failed', appid }, 502);
    }
    if (!html.includes(appid)) {
        return json({ ok: false, error: 'mini-program not found or not plugin-type', appid }, 404);
    }

    const logo = pickFirst(html, [
        /class="mpui-setting__avatar[^"]*"[^>]*style="[^"]*background-image:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i,
        /background-image:\s*url\(\s*['"]?(https?:\/\/[^'")]*qlogo\.cn[^'")]+)/i,
        /background-image:\s*url\(\s*['"]?(https?:\/\/[^'")]*mmbiz\.qpic\.cn[^'")]+)/i,
    ]);
    const name = pickFirst(html, [
        /<strong[^>]+class="[^"]*mpui-setting__name[^"]*"[^>]*>\s*([^<]+?)\s*<\/strong>/i,
    ]);

    if (!logo && !name) return json({ ok: false, error: 'failed to parse', appid }, 502);

    return json({
        ok: true,
        appid,
        name: name || null,
        logo: logo ? upgradeHttps(cleanUrl(logo)) : null,
    });
}

function pickFirst(html, patterns) {
    for (const p of patterns) {
        const m = html.match(p);
        if (m && m[1]) return decodeEntities(m[1].trim());
    }
    return null;
}
function decodeEntities(s) {
    return s
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ');
}
function cleanUrl(u) {
    return u.replace(/\\\//g, '/').replace(/\\&/g, '&');
}
function upgradeHttps(u) {
    return String(u).replace(/^http:\/\//i, 'https://');
}

// ---------------- iTunes Search ----------------

async function handleSearchApp(url) {
    const term = (url.searchParams.get('term') || '').trim();
    const country = (url.searchParams.get('country') || 'cn').trim().toLowerCase();
    const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get('limit') || '10', 10)));

    if (!term) {
        return json({ ok: false, error: 'missing term' }, 400);
    }

    const allowedCountry = /^[a-z]{2}$/.test(country) ? country : 'cn';

    const target = `https://itunes.apple.com/search?` + new URLSearchParams({
        term,
        country: allowedCountry,
        entity: 'software',
        limit: String(limit),
        media: 'software',
    }).toString();

    let data;
    try {
        const resp = await fetch(target, {
            headers: { 'User-Agent': UA },
            cf: { cacheTtl: 600, cacheEverything: true },
        });
        if (!resp.ok) {
            return json({ ok: false, error: `itunes upstream ${resp.status}` }, 502);
        }
        data = await resp.json();
    } catch (e) {
        return json({ ok: false, error: 'itunes fetch failed' }, 502);
    }

    const results = (data.results || []).map((r) => ({
        name: r.trackName,
        author: r.artistName,
        bundleId: r.bundleId,
        trackId: r.trackId,
        // artworkUrl60/100/512 are returned; 512 is highest the API gives directly.
        // Replacing /60x60bb to /1024x1024bb in the URL usually yields the original.
        icon100: r.artworkUrl100,
        icon512: r.artworkUrl512 || (r.artworkUrl100 || '').replace(/\/100x100bb\.jpg$/, '/512x512bb.jpg'),
        icon1024: upscaleArtwork(r.artworkUrl512 || r.artworkUrl100),
        genre: r.primaryGenreName,
        country: r.country,
    }));

    return json({ ok: true, count: results.length, results });
}

// Apple's CDN serves the original image when you ask for /1024x1024bb.jpg (or larger).
// We patch the standard 60/100/512 URLs up to 1024 for the highest-res icon.
function upscaleArtwork(u) {
    if (!u) return null;
    return u.replace(/\/\d+x\d+bb\.(jpg|png|webp)$/i, '/1024x1024bb.$1');
}

// ---------------- image proxy ----------------

// Match by suffix on known image-CDN parent domains. wx.qlogo.cn often resolves
// through subdomains like shp.qpic.cn / wxapp.tc.qq.com / thirdwx.qlogo.cn —
// matching on the parent suffix covers them all without opening up arbitrary hosts.
const ALLOWED_IMG_HOST = /(^|\.)(mzstatic\.com|apple\.com|qpic\.cn|qlogo\.cn)$/i;

async function handleImg(url) {
    const target = url.searchParams.get('url');
    if (!target) return json({ ok: false, error: 'missing url' }, 400);

    let parsed;
    try { parsed = new URL(target); }
    catch { return json({ ok: false, error: 'bad url' }, 400); }

    // Two modes:
    //   strict (default): only known image hosts (Apple CDN + WeChat CDN)
    //   open  (?open=1):  any https host. Used by "any image URL" tab — user-driven, lower risk.
    const open = url.searchParams.get('open') === '1';

    if (!open && !ALLOWED_IMG_HOST.test(parsed.hostname)) {
        return json({ ok: false, error: 'host not in allowlist', host: parsed.hostname }, 403);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return json({ ok: false, error: 'bad protocol' }, 400);
    }

    let upstream;
    try {
        // qlogo.cn / qpic.cn occasionally hotlink-protect by Referer.
        // mp.weixin.qq.com is the actual page that serves these images.
        const isWxImg = /(qlogo\.cn|qpic\.cn)$/i.test(parsed.hostname);
        const referer = isWxImg ? 'https://mp.weixin.qq.com/' : parsed.origin + '/';
        upstream = await fetch(target, {
            headers: {
                'User-Agent': UA,
                'Referer': referer,
            },
            cf: { cacheTtl: 86400, cacheEverything: true },
        });
    } catch (e) {
        return json({ ok: false, error: 'upstream fetch failed', detail: String(e) }, 502);
    }

    if (!upstream.ok) {
        return json({ ok: false, error: 'upstream error', status: upstream.status, host: parsed.hostname }, 502);
    }

    const ct = upstream.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) {
        return json({ ok: false, error: 'not an image', contentType: ct, host: parsed.hostname }, 415);
    }

    const headers = new Headers(CORS);
    headers.set('Content-Type', ct);
    headers.set('Cache-Control', 'public, max-age=86400');
    return new Response(upstream.body, { headers });
}

// ---------------- util ----------------

function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
    });
}
