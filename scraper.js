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
 * فحص الفيديو فعلياً باستخدام ffprobe للتأكد أن الرابط يعمل وبث حقيقي
 */
async function verifyVideo(streamUrl) {
    return new Promise((resolve) => {
        // نضع timeout قصير للفحص حتى لا يعلق السكريبت
        ffmpeg.ffprobe(streamUrl, ["-connect_timeout", "5"], (err, metadata) => {
            if (err) {
                resolve(false);
            } else {
                const hasVideo = metadata.streams.some(s => s.codec_type === 'video');
                resolve(hasVideo);
            }
        });
    });
}

/**
 * استخراج رابط m3u8 المباشر
 * تم تحسين المنطق للبحث داخل الـ Scripts والـ Iframes بعمق أكبر
 */
async function getStreamUrl(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, { 
            timeout: 10000, 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.qanwatlive.com/'
            } 
        });

        const $ = cheerio.load(data);
        
        // 1. البحث عن روابط m3u8 في سكريبتات الصفحة مباشرة
        const scripts = $('script').text();
        const m3u8Match = scripts.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)/);
        if (m3u8Match) return m3u8Match[1].replace(/\\/g, ''); // تنظيف الرابط من أي Backslashes

        // 2. إذا لم يجد، يبحث عن الـ iframe ويحاول استخراج الرابط منه
        const iframeSrc = $('iframe[src*="player"], iframe[src*="stream"], iframe#iframe').attr('src');
        
        if (iframeSrc) {
            const finalIframeUrl = iframeSrc.startsWith('//') ? 'https:' + iframeSrc : iframeSrc;
            const iframeContent = await axios.get(finalIframeUrl, { 
                timeout: 7000, 
                headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': pageUrl } 
            });
            
            const m3u8InIframe = iframeContent.data.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
            if (m3u8InIframe) return m3u8InIframe[1].replace(/\\/g, '');
        }

        return null;
    } catch { return null; }
}

/**
 * معالجة وحفظ الشعار
 */
async function processImage(imgUrl, channelName) {
    if (!imgUrl) return "";
    try {
        const safeName = channelName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_').toLowerCase();
        const fileName = `${safeName}_${Date.now()}.jpg`;
        const filePath = path.join(IMAGE_DIR, fileName);

        const response = await axios({ url: imgUrl, responseType: 'arraybuffer', timeout: 5000 });
        await sharp(response.data)
            .resize(400, 225) // مقاس موحد للـ Android TV
            .jpeg({ quality: 85 })
            .toFile(filePath);

        return `${GITHUB_RAW_BASE}image/${fileName}`;
    } catch { 
        return imgUrl; // في حال الفشل نعود للرابط الأصلي
    }
}

async function startScraping() {
    const finalChannels = [];
    
    const sources = [
        { url: 'https://play.arab-stream.live/', type: 'arab-stream' },
        { url: 'https://www.qanwatlive.com/', type: 'qanwat-live' }
    ];

    for (const source of sources) {
        console.log(`\n🌐 جاري الكشط من مصدر: ${source.url}`);
        try {
            const { data } = await axios.get(source.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $ = cheerio.load(data);
            let items = [];

            if (source.type === 'arab-stream') {
                $('.channel').each((i, el) => {
                    const name = $(el).find('span').text().trim();
                    const page = $(el).find('a').attr('href');
                    if (name && page) {
                        items.push({
                            name: name,
                            page: page,
                            img: $(el).find('img').attr('src'),
                            cat: $(el).closest('.channels').prev('.section-title').text().trim() || "عام"
                        });
                    }
                });
            } else {
                // استهداف كروت قنوات لايف (QanwatLive)
                $('.card, .post-card').each((i, el) => {
                    const name = $(el).find('.name a').text().trim();
                    const page = $(el).find('a.post-link').attr('href') || $(el).find('a').attr('href');
                    if (name && page) {
                        items.push({
                            name: name,
                            page: page,
                            img: $(el).find('img').attr('src'),
                            cat: "بث مباشر"
                        });
                    }
                });
            }

            for (const item of items) {
                const fullPageUrl = item.page.startsWith('http') ? item.page : source.url.replace(/\/$/, '') + '/' + item.page.replace(/^\//, '');
                
                console.log(`🔍 فحص: ${item.name}`);
                
                const streamUrl = await getStreamUrl(fullPageUrl);
                
                if (streamUrl) {
                    // الفحص النهائي للتأكد أن الرابط يفتح فيديو فعلاً
                    const isValid = await verifyVideo(streamUrl);
                    
                    if (isValid) {
                        console.log(`✅ شغال ومتحقق! جاري المعالجة...`);
                        const imgResult = await processImage(item.img, item.name);
                        
                        finalChannels.push({
                            id: channelIdCounter++,
                            name: item.name,
                            category: item.cat,
                            url: streamUrl,
                            image: imgResult,
                            source: source.type,
                            updated_at: new Date().toISOString()
                        });
                    } else {
                        console.log(`❌ الرابط المستخرج لا يعمل (Failed Probe)`);
                    }
                } else {
                    console.log(`⚠️ لم يتم العثور على رابط m3u8`);
                }
            }
        } catch (e) { 
            console.log(`❌ خطأ في المصدر ${source.url}: ${e.message}`); 
        }
    }

    const output = {
        total_channels: finalChannels.length,
        last_update: new Date().toLocaleString('ar-EG'),
        channels: finalChannels
    };

    fs.writeFileSync(JSON_FILE, JSON.stringify(output, null, 2));
    console.log(`\n✨ تم الانتهاء! تم حفظ ${finalChannels.length} قناة شغالة في ${JSON_FILE}`);
}

startScraping();
