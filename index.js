const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// انتحال شخصية مشغل VLC لتخطي حظر سيرفرات Xtream
const IPTV_USER_AGENT = 'VLC/3.0.18 LibVLC/3.0.18';

// مسار تشغيل ملف M3U8 مباشرة
// الاستخدام: /direct?url=http://orien.live/...
app.get('/direct', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Please provide ?url=...');

    try {
        // 1. جلب الرابط الأول، وترك Axios يتبع التحويل (Redirect) تلقائياً للرابط الثاني
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': IPTV_USER_AGENT,
                'Accept': '*/*'
            },
            maxRedirects: 10 // السماح بتتبع التحويلات
        });

        // 2. الحصول على الرابط النهائي بعد التحويل (رقم الـ IP مثل 89.33.13.177)
        const finalUrl = response.request.res.responseUrl || response.config.url || targetUrl;
        const baseUrl = new URL(finalUrl).origin; // النتيجة ستكون السيرفر الأساسي

        // 3. قراءة الملف وتعديل الروابط داخله
        const lines = response.data.split('\n');
        const rewrittenLines = lines.map(line => {
            const trimmed = line.trim();
            
            // ترك أسطر الإعدادات كما هي
            if (!trimmed || trimmed.startsWith('#')) return line; 

            // تكوين الرابط المطلق لملف الـ TS بناءً على السيرفر النهائي
            let absoluteLink = trimmed;
            if (trimmed.startsWith('/')) {
                absoluteLink = baseUrl + trimmed;
            } else if (!trimmed.startsWith('http')) {
                absoluteLink = new URL(trimmed, finalUrl).href;
            }

            // توجيه طلبات الفيديو (TS) إلى السيرفر الخاص بنا
            const hostProtocol = req.headers['x-forwarded-proto'] || req.protocol;
            return `${hostProtocol}://${req.get('host')}/proxy?url=${encodeURIComponent(absoluteLink)}`;
        });

        // إرسال الملف للمشغل
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(rewrittenLines.join('\n'));

    } catch (error) {
        console.error('M3U8 Fetch Error:', error.message);
        res.status(500).send('Error fetching stream manifest');
    }
});

// مسار جلب قطع الفيديو (TS) وتمريرها للمشغل
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');

    try {
        // استخدام تقنية Stream مهم جداً لتجنب استهلاك مساحة الرام وانهيار السيرفر
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': IPTV_USER_AGENT,
                'Accept': '*/*'
            },
            responseType: 'stream'
        });

        // تمرير نوع الملف الصحيح
        res.set('Content-Type', response.headers['content-type'] || 'video/MP2T');
        
        // تدفق البيانات (Pipe) مباشرة إلى المشغل (VLC, ExoPlayer, etc)
        response.data.pipe(res);

    } catch (error) {
        console.error('TS Segment Error:', error.message);
        res.status(500).send('Error proxying video segment');
    }
});

// تشغيل السيرفر
app.listen(PORT, () => {
    console.log(`Direct IPTV Proxy running on port ${PORT}`);
});
