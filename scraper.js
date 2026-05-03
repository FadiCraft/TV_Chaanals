const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');

// الإعدادات
const IMAGE_DIR = './image';
const JSON_FILE = 'channels.json';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/FadiCraft/TV_Chaanals/refs/heads/main/';

if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

/**
 * فحص الفيديو فعلياً باستخدام ffprobe
 */
async function verifyVideo(streamUrl) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(streamUrl, ["-connect_timeout", "5"], (err, metadata) => {
            if (err) resolve(false);
            else {
                const hasVideo = metadata.streams.some(s => s.codec_type === 'video');
                resolve(hasVideo);
            }
        });
    });
}

/**
 * استخراج رابط m3u8 المباشر وتنظيفه
 */
async function getStreamUrl(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, { 
            timeout: 10000, 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } 
        });
        const $ = cheerio.load(data);
        
        // 1. البحث في السكريبتات
        const scripts = $('script').text();
        const m3u8Match = scripts.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)/);
        if (m3u8Match) return m3u8Match[1].replace(/\\/g, '');

        // 2. البحث داخل iframe
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

/**
 * معالجة الصورة وحفظها
 */
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

async function startScraping() {
    const finalChannels = [];
    const currentTime = new Date().toLocaleString('ar-EG');
    
    // تعريف المصادر وكيفية التعامل مع كل واحد
    const sources = [
        { 
            name: 'ArabStream', 
            url: 'https://play.arab-stream.live/', 
            selector: '.channel' 
        },
        { 
            name: 'QanwatLive', 
            url: 'https://www.qanwatlive.com/', 
            selector: '.card, .post-card' 
        }
    ];

    for (const source of sources) {
        console.log(`\n🌐 جاري استخراج البيانات من: ${source.name}`);
        try {
            const { data } = await axios.get(source.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $ = cheerio.load(data);
            let items = [];

            $(source.selector).each((i, el) => {
                let name, page, img, cat;

                if (source.name === 'ArabStream') {
                    name = $(el).find('span').text().trim();
                    page = $(el).find('a').attr('href');
                    img = $(el).find('img').attr('src');
                    cat = $(el).closest('.channels').prev('.section-title').text().trim() || "عام";
                } else {
                    name = $(el).find('.name a').text().trim() || $(el).find('.name').text().trim();
                    page = $(el).find('a.post-link').attr('href') || $(el).find('a').attr('href');
                    img = $(el).find('img').attr('src');
                    cat = "بث مباشر";
                }

                if (name && page) items.push({ name, page, img, cat });
            });

            for (const item of items) {
                const fullPageUrl = item.page.startsWith('http') ? item.page : source.url.replace(/\/$/, '') + '/' + item.page.replace(/^\//, '');
                
                console.log(`🔍 فحص [${source.name}]: ${item.name}`);
                const streamUrl = await getStreamUrl(fullPageUrl);
                
                if (streamUrl && await verifyVideo(streamUrl)) {
                    console.log(`✅ شغال!`);
                    const localImg = await processImage(item.img, item.name);
                    
                    finalChannels.push({
                        name: item.name,
                        category: item.cat,
                        url: streamUrl,
                        server_url: fullPageUrl,
                        local_img: localImg,
                        original_img: item.img || "",
                        status: source.name, // هنا وضعنا اسم الموقع المستخرج منه
                        last_update: currentTime
                    });
                }
            }
        } catch (e) {
            console.log(`❌ خطأ في ${source.name}: ${e.message}`);
        }
    }

    // حفظ النتيجة النهائية كمصفوفة
    fs.writeFileSync(JSON_FILE, JSON.stringify(finalChannels, null, 2), 'utf-8');
    console.log(`\n✨ تم التحديث! إجمالي القنوات الشغالة: ${finalChannels.length}`);
}

startScraping();
