const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');

const IMAGE_DIR = './image';
const JSON_FILE = 'channels.json';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/FadiCraft/TV_Chaanals/refs/heads/main/';
const BASE_URL = 'http://www.azrotv.com';

if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

/**
 * فحص دفق الفيديو باستخدام ffprobe مع مهلة زمنية قصيرة للسرعة
 */
async function verifyVideo(streamUrl) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(streamUrl, ["-connect_timeout", "3", "-timeout", "3000000"], (err, metadata) => {
            if (err) resolve(false);
            else {
                const hasVideo = metadata.streams.some(s => s.codec_type === 'video');
                resolve(hasVideo);
            }
        });
    });
}

/**
 * استخراج رابط m3u8 من صفحة القناة مع دعم الـ iframes المتعددة
 */
async function getStreamUrl(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, { 
            timeout: 8000, 
            headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)' } 
        });

        const $ = cheerio.load(data);
        let m3u8Links = [];

        // 1. البحث عن روابط m3u8 مباشرة في السكريبتات
        const scripts = $('script').text();
        const m3u8Matches = scripts.match(/https?:\/\/[^"']+\.m3u8[^"']*/g);
        if (m3u8Matches) m3u8Links.push(...m3u8Matches);

        // 2. البحث داخل جميع الـ iframes الموجودة (لأنك قلت قد تجد سيرفرين)
        const iframes = $('iframe').toArray();
        for (const iframe of iframes) {
            let src = $(iframe).attr('src');
            if (src) {
                // معالجة الروابط التي تبدأ بـ /
                if (src.startsWith('/')) src = BASE_URL + src;
                
                // إذا كان الرابط يحتوي على id=http... (كما في مثالك)
                if (src.includes('id=')) {
                    const potentialUrl = src.split('id=')[1].split('&')[0];
                    if (potentialUrl.includes('.m3u8')) m3u8Links.push(potentialUrl);
                }

                // محاولة جلب محتوى الـ iframe إذا لم نجد الرابط في العنوان
                try {
                    const iframeRes = await axios.get(src, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } });
                    const innerMatches = iframeRes.data.match(/https?:\/\/[^"']+\.m3u8[^"']*/g);
                    if (innerMatches) m3u8Links.push(...innerMatches);
                } catch (e) {}
            }
        }

        // تنظيف الروابط وتكرارها
        const uniqueLinks = [...new Set(m3u8Links)].map(l => l.replace(/\\/g, ''));
        
        // فحص الروابط المستخرجة واختيار أول واحد يعمل
        for (const link of uniqueLinks) {
            if (await verifyVideo(link)) return link;
        }
        
        return null;
    } catch { return null; }
}

async function processImage(imgUrl, channelName) {
    if (!imgUrl) return "";
    try {
        const safeName = channelName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_').toLowerCase();
        const fileName = `${safeName}.jpg`;
        const filePath = path.join(IMAGE_DIR, fileName);

        let finalImgUrl = imgUrl.startsWith('..') ? imgUrl.replace('..', BASE_URL) : imgUrl;
        if (finalImgUrl.startsWith('/')) finalImgUrl = BASE_URL + finalImgUrl;

        const response = await axios({ url: finalImgUrl, responseType: 'arraybuffer', timeout: 5000 });
        await sharp(response.data)
            .resize(400, 225)
            .jpeg({ quality: 85 })
            .toFile(filePath);

        return `${GITHUB_RAW_BASE}image/${fileName}`;
    } catch { return ""; }
}

async function startScraping() {
    const finalChannels = [];
    const currentTime = new Date().toLocaleString('ar-EG');
    
    // قائمة الصفحات المطلوب كشطها من الموقع
    const pages = [
        'http://www.azrotv.com/iphone/arabic/',
        'http://www.azrotv.com/iphone/arabic/mobi_arabic_2.php',
        'http://www.azrotv.com/iphone/arabic/mobi_arabic_3.php',
        'http://www.azrotv.com/iphone/arabic/mobi_arabic_4.php',
        'http://www.azrotv.com/iphone/arabic/mobi_arabic_5.php',
        'http://www.azrotv.com/iphone/arabic/mobi_arabic_6.php',
        'http://www.azrotv.com/iphone/arabic/mobi_arabic_7.php',
        'http://www.azrotv.com/iphone/arabic/iraq.php',
        'http://www.azrotv.com/iphone/arabic/tn.php'
    ];

    for (const pageUrl of pages) {
        console.log(`\n🌐 جاري استخراج القنوات من: ${pageUrl}`);
        try {
            const { data } = await axios.get(pageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $ = cheerio.load(data);
            
            const items = [];
            $('.BlockCha').each((i, el) => {
                const linkTag = $(el).find('a.Azrotv-ChUrl');
                const imgTag = $(el).find('img.oui9img');
                
                let pageLink = linkTag.attr('href');
                if (pageLink && pageLink.startsWith('/')) pageLink = BASE_URL + pageLink;

                items.push({
                    name: imgTag.attr('alt') ? imgTag.attr('alt').replace(' بث مباشر', '').trim() : "قناة غير معروفة",
                    page: pageLink,
                    img: imgTag.attr('src'),
                    cat: "عربي"
                });
            });

            for (const item of items) {
                if (!item.page) continue;
                console.log(`🔍 فحص قناة: ${item.name}`);
                
                const streamUrl = await getStreamUrl(item.page);
                
                if (streamUrl) {
                    console.log(`✅ تم العثور على سيرفر شغال!`);
                    const localImg = await processImage(item.img, item.name);
                    
                    finalChannels.push({
                        name: item.name,
                        category: item.cat,
                        url: streamUrl,
                        server_url: item.page,
                        local_img: localImg,
                        status: "online",
                        last_update: currentTime
                    });
                } else {
                    console.log(`❌ لا يوجد سيرفر متاح`);
                }
            }
        } catch (e) { console.log(`❌ خطأ في الصفحة: ${e.message}`); }
    }

    fs.writeFileSync(JSON_FILE, JSON.stringify(finalChannels, null, 2));
    console.log(`\n✨ انتهى البحث! تم حفظ ${finalChannels.length} قناة.`);
}

startScraping();
