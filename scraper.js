const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');

// الإعدادات الموحدة
const IMAGE_DIR = './image';
const JSON_FILE = 'channels.json'; 
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/FadiCraft/TV_Chaanals/refs/heads/main/';

if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

/**
 * دالة فحص الفيديو (ffprobe)
 */
async function verifyVideo(streamUrl) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(streamUrl, ["-connect_timeout", "5"], (err, metadata) => {
            if (err) resolve(false);
            else {
                const hasVideo = metadata.streams && metadata.streams.some(s => s.codec_type === 'video');
                resolve(hasVideo);
            }
        });
    });
}

/**
 * دالة معالجة الصور
 */
async function processImage(imgUrl, channelName) {
    if (!imgUrl) return "";
    try {
        const safeName = channelName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_').toLowerCase();
        const fileName = `${safeName}.jpg`;
        const filePath = path.join(IMAGE_DIR, fileName);

        const response = await axios({ url: imgUrl, responseType: 'arraybuffer', timeout: 5000 });
        await sharp(response.data)
            .resize(400, 225)
            .jpeg({ quality: 85 })
            .toFile(filePath);

        return `${GITHUB_RAW_BASE}image/${fileName}`;
    } catch { return ""; }
}

/**
 * استخراج الرابط لموقع Arab Stream (من الكود مباشرة)
 */
async function getArabStreamLink(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const match = data.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        return match ? match[1] : null;
    } catch { return null; }
}

/**
 * استخراج الرابط لموقع Qanwat Live (البحث العميق في iframe)
 */
async function getQanwatLiveLink(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(data);
        
        // محاولة 1: من السكريبتات
        const scripts = $('script').text();
        const m3u8Match = scripts.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)/);
        if (m3u8Match) return m3u8Match[1].replace(/\\/g, '');

        // محاولة 2: داخل iframe
        const iframeSrc = $('iframe[src*="player"], iframe[src*="stream"], iframe#iframe').attr('src');
        if (iframeSrc) {
            const finalIframeUrl = iframeSrc.startsWith('//') ? 'https:' + iframeSrc : iframeSrc;
            const iframeContent = await axios.get(finalIframeUrl, { timeout: 7000, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const m3u8InIframe = iframeContent.data.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
            if (m3u8InIframe) return m3u8InIframe[1].replace(/\\/g, '');
        }
        return null;
    } catch { return null; }
}

async function startScraping() {
    const allChannels = [];
    const currentTime = new Date().toLocaleString('ar-EG');

    // المصادر وتعريف طريقة العمل لكل مصدر
    const sources = [
        { url: 'https://play.arab-stream.live/', type: 'arab-stream' },
        { url: 'https://www.qanwatlive.com/', type: 'qanwat-live' }
    ];

    for (const source of sources) {
        console.log(`\n🌐 بدأت العمل على: ${source.url}`);
        try {
            const { data } = await axios.get(source.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $ = cheerio.load(data);
            let items = [];

            // --- الجزء الخاص باستخراج العناصر من الصفحة الرئيسية (يختلف لكل موقع) ---
            if (source.type === 'arab-stream') {
                $('.channel').each((i, el) => {
                    items.push({
                        name: $(el).find('span').text().trim(),
                        page: $(el).find('a').attr('href'),
                        img: $(el).find('img').attr('src'),
                        cat: $(el).closest('.channels').prev('.section-title').text().trim() || "غير مصنف"
                    });
                });
            } else {
                $('.card, .post-card').each((i, el) => {
                    items.push({
                        name: $(el).find('.name a').text().trim() || $(el).find('.name').text().trim(),
                        page: $(el).find('a.post-link').attr('href') || $(el).find('a').attr('href'),
                        img: $(el).find('img').attr('src'),
                        cat: $(el).closest('.blog-section').find('.section-title').text().trim() || "بث مباشر"
                    });
                });
            }

            // --- فحص القنوات ومعالجة الروابط (باستخدام المنطق الخاص بكل موقع) ---
            for (const item of items) {
                if (!item.page || !item.name) continue;
                const fullPageUrl = item.page.startsWith('http') ? item.page : source.url.replace(/\/$/, '') + '/' + item.page.replace(/^\//, '');
                
                console.log(`🔍 فحص: ${item.name}`);
                
                // استدعاء الدالة المناسبة حسب نوع الموقع
                const streamUrl = (source.type === 'arab-stream') 
                    ? await getArabStreamLink(fullPageUrl) 
                    : await getQanwatLiveLink(fullPageUrl);

                if (streamUrl && await verifyVideo(streamUrl)) {
                    console.log(`✅ شغال!`);
                    const localImg = await processImage(item.img, item.name);
                    allChannels.push({
                        name: item.name,
                        category: item.cat,
                        url: streamUrl,
                        local_img: localImg,
                        original_img: item.img || "",
                        status: "online",
                        last_update: currentTime
                    });
                }
            }
        } catch (e) { console.log(`❌ خطأ في المصدر: ${e.message}`); }
    }

    // حفظ جميع البيانات من المصدرين في ملف واحد
    fs.writeFileSync(JSON_FILE, JSON.stringify(allChannels, null, 2));
    console.log(`\n✨ انتهى الدمج! تم حفظ ${allChannels.length} قناة في ملف ${JSON_FILE}`);
}

startScraping();
