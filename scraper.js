const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');

const IMAGE_DIR = './image';
const JSON_FILE = 'channels.json';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/FadiCraft/TV_Chaanals/refs/heads/main/';

if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

let channelIdCounter = 1;

/**
 * فحص دفق الفيديو باستخدام ffprobe
 */
async function verifyVideo(streamUrl) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(streamUrl, (err, metadata) => {
            if (err) resolve(false);
            else {
                const hasVideo = metadata.streams.some(s => s.codec_type === 'video');
                resolve(hasVideo);
            }
        });
    });
}

/**
 * استخراج رابط m3u8 من أي صفحة (سواء صفحة القناة أو صفحة السيرفر/الفريم)
 */
async function getStreamUrl(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        // البحث عن iframe أولاً في حال كان السيرفر داخل فريم
        const $ = cheerio.load(data);
        const iframeSrc = $('iframe#iframe').attr('src') || $('iframe').attr('src');
        
        let targetData = data;
        if (iframeSrc) {
            const iframeContent = await axios.get(iframeSrc, { timeout: 7000, headers: { 'User-Agent': 'Mozilla/5.0' } });
            targetData = iframeContent.data;
        }

        const match = targetData.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        return match ? match[1] : null;
    } catch { return null; }
}

/**
 * معالجة الصورة بناءً على الصيغة
 */
async function processImage(imgUrl, channelName) {
    if (!imgUrl) return "";
    try {
        // إذا كانت webp، نقوم بتحويلها وحفظها
        if (imgUrl.includes('.webp')) {
            const safeName = channelName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_').toLowerCase();
            const fileName = `${safeName}_${channelIdCounter}.jpg`;
            const filePath = path.join(IMAGE_DIR, fileName);
            const response = await axios({ url: imgUrl, responseType: 'arraybuffer' });
            await sharp(response.data).jpeg({ quality: 85 }).toFile(filePath);
            return `${GITHUB_RAW_BASE}image/${fileName}`;
        }
        // إذا كانت jpg أو png، نستخدم الرابط المباشر
        return imgUrl;
    } catch { return imgUrl; }
}

async function startScraping() {
    const finalChannels = [];
    
    // المصادر
    const sources = [
        { url: 'https://play.arab-stream.live/', type: 'arab-stream' },
        { url: 'https://www.qanwatlive.com/', type: 'qanwat-live' }
    ];

    for (const source of sources) {
        console.log(`\n🌐 جاري الكشط من مصدر: ${source.url}`);
        try {
            const { data } = await axios.get(source.url);
            const $ = cheerio.load(data);
            let items = [];

            if (source.type === 'arab-stream') {
                $('.channel').each((i, el) => {
                    items.push({
                        name: $(el).find('span').text().trim(),
                        page: $(el).find('a').attr('href'),
                        img: $(el).find('img').attr('src'),
                        cat: $(el).closest('.channels').prev('.section-title').text().trim()
                    });
                });
            } else {
                $('.card').each((i, el) => {
                    items.push({
                        name: $(el).find('.name a').text().trim(),
                        page: $(el).find('.card-image a').attr('href'),
                        img: $(el).find('img').attr('src'),
                        cat: $(el).closest('.blog-section').data('category') || "عام"
                    });
                });
            }

            for (const item of items) {
                const fullPageUrl = item.page.startsWith('http') ? item.page : source.url.slice(0, -1) + item.page;
                console.log(`🔍 فحص: ${item.name}`);
                
                const streamUrl = await getStreamUrl(fullPageUrl);
                if (streamUrl && await verifyVideo(streamUrl)) {
                    console.log(`✅ شغال! جاري المعالجة...`);
                    const imgResult = await processImage(item.img, item.name);
                    
                    finalChannels.push({
                        id: channelIdCounter++,
                        name: item.name,
                        category: item.cat,
                        url: streamUrl,
                        image: imgResult,
                        source: source.type
                    });
                }
            }
        } catch (e) { console.log(`❌ خطأ في المصدر ${source.url}: ${e.message}`); }
    }

    fs.writeFileSync(JSON_FILE, JSON.stringify({
        total_channels: finalChannels.length,
        last_update: new Date().toLocaleString('ar-EG'),
        channels: finalChannels
    }, null, 2));
    
    console.log(`\n✨ تم الانتهاء! إجمالي القنوات الشغالة: ${finalChannels.length}`);
}

startScraping();
