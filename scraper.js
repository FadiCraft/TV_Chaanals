const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');

// الإعدادات الموحدة
const IMAGE_DIR = './image';
const JSON_FILE = 'channels.json'; // الملف النهائي الموحد
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/FadiCraft/TV_Chaanals/refs/heads/main/';

if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

/**
 * فحص دفق الفيديو باستخدام ffprobe
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
 * استخراج رابط m3u8 من صفحات المواقع المختلفة
 */
async function getStreamUrl(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, { 
            timeout: 10000, 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } 
        });

        // البحث عن روابط m3u8 مباشرة في النص أو السكريبتات
        const m3u8Match = data.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)/);
        if (m3u8Match) return m3u8Match[1].replace(/\\/g, '');

        // البحث داخل iframe (خاص بموقع قنوات لايف)
        const $ = cheerio.load(data);
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
 * معالجة الصور وحفظها
 */
async function processImage(imgUrl, channelName) {
    if (!imgUrl) return "";
    try {
        const safeName = channelName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_').toLowerCase();
        const fileName = `${safeName}.jpg`;
        const filePath = path.join(IMAGE_DIR, fileName);

        const response = await axios({ url: imgUrl, responseType: 'arraybuffer', timeout: 5000 });
        await sharp(response.data)
            .resize(400, 225, { fit: 'cover' })
            .jpeg({ quality: 85 })
            .toFile(filePath);

        return `${GITHUB_RAW_BASE}image/${fileName}`;
    } catch { 
        return imgUrl; // العودة للرابط الأصلي في حال فشل المعالجة
    }
}

/**
 * الوظيفة الرئيسية لبدء الكشط من جميع المصادر
 */
async function startScraping() {
    const finalChannels = [];
    const currentTime = new Date().toLocaleString('ar-EG');
    
    const sources = [
        { url: 'https://play.arab-stream.live/', type: 'arab-stream' },
        { url: 'https://www.qanwatlive.com/', type: 'qanwat-live' }
    ];

    for (const source of sources) {
        console.log(`\n🚀 جاري العمل على مصدر: ${source.url}`);
        try {
            const { data } = await axios.get(source.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $ = cheerio.load(data);
            let items = [];

            // تحديد طريقة استخراج العناصر بناءً على نوع الموقع
            if (source.type === 'arab-stream') {
                $('.channel').each((i, el) => {
                    items.push({
                        name: $(el).find('span').text().trim(),
                        page: $(el).find('a').attr('href'),
                        img: $(el).find('img').attr('src'),
                        cat: $(el).closest('.channels').prev('.section-title').text().trim() || "عرب ستريم"
                    });
                });
            } else if (source.type === 'qanwat-live') {
                $('.card, .post-card').each((i, el) => {
                    items.push({
                        name: $(el).find('.name a').text().trim() || $(el).find('.name').text().trim(),
                        page: $(el).find('a.post-link').attr('href') || $(el).find('a').attr('href'),
                        img: $(el).find('img').attr('src'),
                        cat: $(el).closest('.blog-section').find('.section-title').text().trim() || "قنوات لايف"
                    });
                });
            }

            // فحص العناصر المستخرجة
            for (const item of items) {
                if (!item.page || !item.name) continue;
                
                // بناء الرابط الكامل للصفحة
                let fullPageUrl = item.page;
                if (!item.page.startsWith('http')) {
                    fullPageUrl = source.url.replace(/\/$/, '') + '/' + item.page.replace(/^\//, '');
                }
                
                console.log(`🔍 فحص القناة: [${item.name}] من مصدر [${source.type}]`);
                const streamUrl = await getStreamUrl(fullPageUrl);
                
                if (streamUrl && await verifyVideo(streamUrl)) {
                    console.log(`✅ القناة تعمل! جاري معالجة الصورة...`);
                    const localImg = await processImage(item.img, item.name);
                    
                    finalChannels.push({
                        name: item.name,
                        category: item.cat,
                        url: streamUrl,
                        server_url: fullPageUrl,
                        local_img: localImg,
                        original_img: item.img || "",
                        status: "online",
                        source_type: source.type, // إضافة نوع المصدر للتمييز
                        last_update: currentTime
                    });
                } else {
                    console.log(`❌ القناة متوقفة أو لم يتم العثور على رابط.`);
                }
            }
        } catch (e) {
            console.log(`❌ خطأ في المصدر ${source.url}: ${e.message}`);
        }
    }

    // حفظ جميع النتائج في ملف JSON واحد
    if (finalChannels.length > 0) {
        fs.writeFileSync(JSON_FILE, JSON.stringify(finalChannels, null, 2), 'utf-8');
        console.log(`\n✨ انتهى العمل بنجاح!`);
        console.log(`📊 إجمالي القنوات الشغالة والمحفوظة في ${JSON_FILE}: ${finalChannels.length}`);
    } else {
        console.log(`\n⚠️ لم يتم العثور على أي قنوات تعمل، لم يتم تحديث الملف.`);
    }
}

startScraping();
