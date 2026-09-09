const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// انتحال شخصية مشغل شرعي لتخطي الحماية المبدئية
const IPTV_USER_AGENT = 'VLC/3.0.18 LibVLC/3.0.18';

app.get('/play', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Please provide ?url=...');

    try {
        // 1. الدخول للرابط الأول وتتبع التحويلات تلقائياً
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': IPTV_USER_AGENT,
                'Accept': '*/*'
            },
            maxRedirects: 5, // السماح بتتبع التحويل وصولاً للـ IP
            responseType: 'stream' // مهم جداً: استخدام stream لمنع تحميل الملف بالكامل على سيرفرك
        });

        // 2. اقتناص الرابط النهائي (الذي يحتوي على Token و IP)
        const finalUrl = response.request.res.responseUrl || response.config.url || targetUrl;

        // 3. إيقاف الاتصال فوراً من طرف سيرفرنا لأننا حصلنا على ما نريد (الرابط النهائي)
        response.data.destroy();

        // 4. توجيه مشغل المستخدم (ExoPlayer) للرابط المباشر
        // HTTP 302 تعني (Redirect / تحويل مؤقت)
        res.redirect(302, finalUrl);

    } catch (error) {
        // في حال كان الرابط محمي جداً أو لا يعمل
        if (error.response && error.response.status === 302 && error.response.headers.location) {
            // بعض السيرفرات ترفض تتبع التحويل عبر Axios، فنلتقط مسار التحويل من الـ Header ونحوله
            return res.redirect(302, error.response.headers.location);
        }
        
        console.error('Resolver Error:', error.message);
        res.status(500).send('Error resolving stream URL');
    }
});

app.listen(PORT, () => {
    console.log(`Smart IPTV Resolver running on port ${PORT}`);
});
