const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');

// الإعدادات المشتركة
const IMAGE_DIR = './image';
const JSON_FILE = 'channels.json';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/FadiCraft/TV_Chaanals/refs/heads/main/';

if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

// مصفوفة واحدة تجمع كل النتائج من الكودين
let allChannels = [];

/**
 * وظائف مساعدة مشتركة
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

async function processImage(imgUrl, channelName) {
    if (!imgUrl) return "";
    try {
        const safeName = channelName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_').toLowerCase();
        const fileName = `${safeName}.jpg`;
        const filePath = path.join(IMAGE_DIR, fileName);
        const response = await axios({ url: imgUrl, responseType: 'arraybuffer', timeout: 5000 });
        await sharp(response.data).resize(400, 225).jpeg({ quality: 85 }).toFile(filePath);
        return `${GITHUB_RAW_BASE}image/${fileName}`;
    } catch { return imgUrl || ""; }
}

// ==========================================
// الكود الأول: arab-stream.js (كمنطق منفصل)
// ==========================================
async function runArabStream() {
    console.log('🚀 بدء الكود الأول (Arab Stream)...');
    try {
        const { data } = await axios.get('https://play.arab-stream.live/');
        const $ = cheerio.load(data);
        const elements = $('.channel');

        for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            const name = $(el).find('span').text().trim();
            const href = $(el).find('a').attr('href');
            const img = $(el).find('img').attr('src');

            if (name && href) {
                const fullPageUrl = href.startsWith('http') ? href : `https://play.arab-stream.live${href}`;
                console.log(`🔍 فحص [ArabStream]: ${name}`);
                
                // منطق استخراج الرابط الخاص بهذا الموقع
                const pageContent = await axios.get(fullPageUrl, { timeout: 10000 }).catch(() => null);
                if (!pageContent) continue;
                const match = pageContent.data.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
                const streamUrl = match ? match[1] : null;

                if (streamUrl && await verifyVideo(streamUrl)) {
                    const localImg = await processImage(img, name);
                    allChannels.push({
                        name,
                        category: $(el).closest('.channels').prev('.section-title').text().trim() || "عام",
                        url: streamUrl,
                        local_img: localImg,
                        original_img: img,
                        status: "online",
                        last_update: new Date().toLocaleString('ar-EG')
                    });
                }
            }
        }
    } catch (err) { console.log('❌ خطأ في كود عرب ستريم:', err.message); }
}

// ==========================================
// الكود الثاني: qanwat-live.js (كمنطق منفصل)
// ==========================================
async function runQanwatLive() {
    console.log('\n🚀 بدء الكود الثاني (Qanwat Live)...');
    try {
        const { data } = await axios.get('https://www.qanwatlive.com/');
        const $ = cheerio.load(data);
        
        // استخدام السليكتورز الخاصة بالموقع الثاني
        const items = [];
        $('.card, .post-card, article').each((i, el) => {
            items.push({
                name: $(el).find('.name a, .title a, h2').text().trim(),
                page: $(el).find('a').attr('href'),
                img: $(el).find('img').attr('src') || $(el).find('img').attr('data-src'),
                cat: "بث مباشر"
            });
        });

        for (const item of items) {
            if (!item.page || !item.name || item.name === "") continue;
            console.log(`🔍 فحص [QanwatLive]: ${item.name}`);

            // منطق استخراج الرابط العميق (Deep Scraping) الخاص بالموقع الثاني
            try {
                const pageRes = await axios.get(item.page, { timeout: 10000 });
                const $page = cheerio.load(pageRes.data);
                let streamUrl = null;

                const m3u8Match = pageRes.data.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
                if (m3u8Match) streamUrl = m3u8Match[1].replace(/\\/g, '');

                if (!streamUrl) {
                    const iframeSrc = $page('iframe[src*="player"], iframe[src*="stream"]').attr('src');
                    if (iframeSrc) {
                        const ifr = await axios.get(iframeSrc.startsWith('//') ? 'https:' + iframeSrc : iframeSrc).catch(() => null);
                        const m3u8InIfr = ifr?.data.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
                        if (m3u8InIfr) streamUrl = m3u8InIfr[1].replace(/\\/g, '');
                    }
                }

                if (streamUrl && await verifyVideo(streamUrl)) {
                    const localImg = await processImage(item.img, item.name);
                    allChannels.push({
                        name: item.name,
                        category: item.cat,
                        url: streamUrl,
                        local_img: localImg,
                        original_img: item.img || "",
                        status: "online",
                        last_update: new Date().toLocaleString('ar-EG')
                    });
                }
            } catch (e) {}
        }
    } catch (err) { console.log('❌ خطأ في كود قنوات لايف:', err.message); }
}

// ==========================================
// تشغيل الكودين وحفظ الملف النهائي
// ==========================================
async function main() {
    // تشغيل الكود الأول
    await runArabStream();
    
    // تشغيل الكود الثاني
    await runQanwatLive();

    // حفظ المصفوفة الموحدة في ملف واحد
    if (allChannels.length > 0) {
        fs.writeFileSync(JSON_FILE, JSON.stringify(allChannels, null, 2), 'utf-8');
        console.log(`\n✨ تم الانتهاء! إجمالي القنوات من المصدرين: ${allChannels.length}`);
        console.log(`📂 تم حفظ الكل في ملف: ${JSON_FILE}`);
    } else {
        console.log('\n⚠️ لم يتم العثور على أي قنوات شغالة.');
    }
}

main();
