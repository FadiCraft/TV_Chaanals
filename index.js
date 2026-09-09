const express = require('express');
const axios = require('axios');
const compression = require('compression');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

const SECRET_KEY = process.env.SECRET_KEY || 'my-super-secret-streaming-key-2026';
const TOKEN_EXPIRY_HOURS = 2;

// ==========================================
// 1. نظام الحماية الذكي للاتصالات
// ==========================================
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10, keepAliveMsecs: 10000 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10, keepAliveMsecs: 10000 });

const IPTV_USER_AGENT = 'VLC/3.0.18 LibVLC/3.0.18';
const TURKEY_PROXY_IP = '85.153.45.12'; // IP تركي وهمي لتجاوز الجغرافيا

const axiosInstance = axios.create({
    httpAgent,
    httpsAgent,
    timeout: 10000,
    maxRedirects: 10
});

// ==========================================
// 2. كلاس الكاش الذكي
// ==========================================
class SmartCache {
    constructor(maxItems = 300, defaultTtlMs = 60000) {
        this.maxItems = maxItems;
        this.defaultTtlMs = defaultTtlMs;
        this.cache = new Map();
    }

    get(key) {
        if (!this.cache.has(key)) return null;
        const item = this.cache.get(key);
        if (Date.now() > item.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        this.cache.delete(key);
        this.cache.set(key, item);
        return item.data;
    }

    getStale(key) {
        if (!this.cache.has(key)) return null;
        return this.cache.get(key).data;
    }

    set(key, data, ttlMs = this.defaultTtlMs) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxItems) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
        this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
    }

    delete(key) {
        this.cache.delete(key);
    }
}

const manifestCache = new SmartCache(50, 3000); 

const manifestPromises = new Map();
const cooldowns = new Map();

function isCoolingDown(url) {
    const until = cooldowns.get(url);
    if (!until) return false;
    if (Date.now() > until) {
        cooldowns.delete(url);
        return false;
    }
    return true;
}

function setCooldown(url, durationMs = 4000) {
    cooldowns.set(url, Date.now() + durationMs);
}

// ==========================================
// 3. دوال مساعدة
// ==========================================
app.use(compression());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

function getHeadersForUrl(targetUrl) {
    try {
        const parsedUrl = new URL(targetUrl);
        return {
            'User-Agent': IPTV_USER_AGENT,
            'Accept': '*/*',
            'Referer': `${parsedUrl.origin}/`,
            'Origin': parsedUrl.origin,
            'X-Forwarded-For': TURKEY_PROXY_IP,
            'X-Real-IP': TURKEY_PROXY_IP,
            'Client-IP': TURKEY_PROXY_IP
        };
    } catch (e) {
        return { 
            'User-Agent': IPTV_USER_AGENT,
            'X-Forwarded-For': TURKEY_PROXY_IP,
            'X-Real-IP': TURKEY_PROXY_IP
        };
    }
}

function generateShortToken(targetUrl) {
    const expiresAt = Date.now() + (TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);
    const payload = JSON.stringify({ url: targetUrl, exp: expiresAt });
    const base64Payload = Buffer.from(payload).toString('base64url');
    const signature = crypto.createHmac('sha256', SECRET_KEY).update(base64Payload).digest('hex');
    return `${base64Payload}.${signature}`;
}

function decryptShortToken(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 2) return { error: 'Invalid' };
        const [base64Payload, signature] = parts;
        const expectedSignature = crypto.createHmac('sha256', SECRET_KEY).update(base64Payload).digest('hex');
        if (signature !== expectedSignature) return { error: 'Invalid' };
        
        const payloadJson = Buffer.from(base64Payload, 'base64url').toString('utf8');
        const { url, exp } = JSON.parse(payloadJson);
        if (Date.now() > exp) return { error: 'Expired' };
        
        return { targetUrl: url };
    } catch (e) {
        return { error: 'Invalid' };
    }
}

// ==========================================
// 4. جلب المانفيست
// ==========================================
async function fetchAndRewriteManifest(targetUrl, req) {
    const cachedData = manifestCache.get(targetUrl);
    if (cachedData) return cachedData;

    if (manifestPromises.has(targetUrl)) return manifestPromises.get(targetUrl);

    if (isCoolingDown(targetUrl)) {
        const stale = manifestCache.getStale(targetUrl);
        if (stale) return stale;
        throw new Error('Origin server on cooldown');
    }

    const promise = (async () => {
        try {
            const response = await axiosInstance.get(targetUrl, {
                headers: getHeadersForUrl(targetUrl),
                validateStatus: status => status >= 200 && status < 500
            });

            if (response.status >= 400 || typeof response.data !== 'string') {
                setCooldown(targetUrl, 3000);
                const stale = manifestCache.getStale(targetUrl);
                if (stale) return stale;
                throw new Error(`Origin error HTTP ${response.status}`);
            }

            const finalUrl = response.request?.res?.responseUrl || response.config?.url || targetUrl;
            const parsedFinalUrl = new URL(finalUrl);
            const baseUrl = parsedFinalUrl.origin;

            let lines = response.data.split('\n');
            let rewrittenLines = lines.map(line => {
                let trimmed = line.trim();
                if (trimmed.startsWith('#') || !trimmed) return trimmed;

                let absoluteLink = trimmed.startsWith('http') ? trimmed 
                                 : trimmed.startsWith('/') ? baseUrl + trimmed 
                                 : new URL(trimmed, finalUrl).href;

                const hostProtocol = req.headers['x-forwarded-proto'] || req.protocol;
                const hostName = req.get('host');
                return `${hostProtocol}://${hostName}/proxy?url=${encodeURIComponent(absoluteLink)}`;
            });

            const finalManifest = rewrittenLines.join('\n');
            manifestCache.set(targetUrl, finalManifest, 3000); 
            return finalManifest;

        } catch (error) {
            setCooldown(targetUrl, 4000);
            const stale = manifestCache.getStale(targetUrl);
            if (stale) return stale;
            throw error;
        } finally {
            manifestPromises.delete(targetUrl);
        }
    })();

    manifestPromises.set(targetUrl, promise);
    return promise;
}

// ==========================================
// 5. المسارات
// ==========================================

app.get('/generate', (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Please provide a ?url=...');

    const token = generateShortToken(targetUrl);
    const hostProtocol = req.headers['x-forwarded-proto'] || req.protocol;
    const shortLink = `${hostProtocol}://${req.get('host')}/play/${token}/manifest.m3u8`;

    res.send(`
        <html dir="rtl" style="background:#0f172a;color:#fff;font-family:sans-serif;text-align:center;padding-top:50px;">
            <h3>رابط البث المشفر:</h3>
            <input type="text" readonly value="${shortLink}" style="width:80%;max-width:600px;padding:10px;background:#1e293b;border:1px solid #475569;color:#38bdf8;border-radius:6px;" onclick="this.select();">
        </html>
    `);
});

app.get('/play/:token/manifest.m3u8', async (req, res) => {
    const { token } = req.params;
    const decrypted = decryptShortToken(token);

    if (decrypted.error === 'Expired') return res.status(403).send('انتهت الصلاحية.');
    if (decrypted.error === 'Invalid' || !decrypted.targetUrl) return res.status(400).send('رابط غير صالح.');

    try {
        const manifest = await fetchAndRewriteManifest(decrypted.targetUrl, req);
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(manifest);
    } catch (error) {
        res.status(500).send('Stream error');
    }
});

app.get('/direct/manifest.m3u8', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Please provide a ?url=...');

    try {
        const manifest = await fetchAndRewriteManifest(targetUrl, req);
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(manifest);
    } catch (error) {
        res.status(500).send('Direct fetch error');
    }
});

// بث التمرير المباشر لقطع TS لمنع استهلاك الرام وسرعة الاستجابة
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');

    try {
        const response = await axiosInstance.get(targetUrl, {
            headers: getHeadersForUrl(targetUrl),
            responseType: 'stream',
            validateStatus: status => status >= 200 && status < 300
        });

        res.set('Content-Type', response.headers['content-type'] || 'video/MP2T');
        response.data.pipe(res);
    } catch (error) {
        res.status(500).send('Proxy Segment Error');
    }
});

app.listen(PORT, () => {
    console.log(`Ultra Smart Proxy running on port ${PORT}`);
});
