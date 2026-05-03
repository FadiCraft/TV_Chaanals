const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');

// الإعدادات الأساسية
const IMAGE_DIR = './image';
const JSON_FILE = 'all_channels.json'; // ملف واحد للجميع
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/FadiCraft/TV_Chaanals/refs/heads/main/';

// إنشاء مجلد الصور إذا لم يكن موجوداً
if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

/**
 * وظيفة فحص دفق الفيديو (Stream Check)
 */
async function verifyVideo(streamUrl) {
    return new Promise((resolve) => {
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
 * استخراج رابط m3u8 من صفحة Arab-Stream
 */
async function getStreamUrlArabStream(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, { 
            timeout: 10000, 
            headers: { 'User-Agent': 'Mozilla/5.0' } 
        });
        const match = data.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

/**
 * استخراج رابط m3u8 من صفحة Qanwat-Live
 */
async function getStreamUrlQanwatLive(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, { 
            timeout: 10000, 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } 
        });

        const $ = cheerio.load(data);
        const scripts = $('script').text();
        
        // محاولة استخراج m3u8 من السكريبتات
        const m3u8Match = scripts.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)/);
        if (m3u8Match) return m3u8Match[1].replace(/\\/g, '');

        // البحث داخل iframe
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
 * تحميل الصورة وتحويلها إلى JPG وحفظها محلياً
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
    } catch { 
        return ""; 
    }
}

/**
 * كشط قنوات Arab-Stream
 */
async function scrapeArabStream() {
    const channels = [];
    const BASE_URL = 'https://play.arab-stream.live/';
    
    try {
        console.log('\n🌐 جاري الكشط من Arab-Stream...');
        const { data } = await axios.get(BASE_URL);
        const $ = cheerio.load(data);
        const elements = $('.channel');

        for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            const name = $(el).find('span').text().trim();
            const href = $(el).find('a').attr('href');
            const img = $(el).find('img').attr('src');

            if (name && href) {
                const fullPageUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
                
                console.log(`🔍 فحص القناة [${name}] من Arab-Stream...`);
                const streamUrl = await getStreamUrlArabStream(fullPageUrl);

                if (streamUrl) {
                    console.log(`📡 وجدنا رابط بث، نختبر الفيديو الآن...`);
                    const isLive = await verifyVideo(streamUrl);

                    if (isLive) {
                        console.log(`✅ فيديو شغال بنجاح!`);
                        channels.push({
                            name,
                            category: $(el).closest('.channels').prev('.section-title').text().trim() || "غير مصنف",
                            url: streamUrl,
                            server_url: fullPageUrl,
                            local_img: "",
                            original_img: img || "",
                            status: "online",
                            source: "arab-stream",
                            last_update: new Date().toLocaleString('ar-EG')
                        });
                    } else {
                        console.log(`⚠️ الرابط موجود ولكن الفيديو متوقف (OFFLINE)`);
                    }
                } else {
                    console.log(`❌ لم نجد رابط m3u8 في هذه الصفحة.`);
                }
            }
        }
    } catch (err) {
        console.error(`❌ خطأ في كشط Arab-Stream:`, err.message);
    }
    
    return channels;
}

/**
 * كشط قنوات Qanwat-Live
 */
async function scrapeQanwatLive() {
    const channels = [];
    const BASE_URL = 'https://www.qanwatlive.com/';
    
    try {
        console.log('\n🌐 جاري الكشط من Qanwat-Live...');
        const { data } = await axios.get(BASE_URL, { 
            headers: { 'User-Agent': 'Mozilla/5.0' } 
        });
        const $ = cheerio.load(data);
        
        $('.card, .post-card').each((i, el) => {
            const name = $(el).find('.name a').text().trim() || $(el).find('.name').text().trim();
            const page = $(el).find('a.post-link').attr('href') || $(el).find('a').attr('href');
            const img = $(el).find('img').attr('src');
            const cat = $(el).closest('.blog-section').find('.section-title').text().trim() || "بث مباشر";

            if (name && page) {
                const fullPageUrl = page.startsWith('http') ? page : BASE_URL + page.replace(/^\//, '');
                
                console.log(`🔍 فحص القناة [${name}] من Qanwat-Live...`);
                getStreamUrlQanwatLive(fullPageUrl).then(async (streamUrl) => {
                    if (streamUrl && await verifyVideo(streamUrl)) {
                        console.log(`✅ فيديو شغال بنجاح!`);
                        channels.push({
                            name,
                            category: cat,
                            url: streamUrl,
                            server_url: fullPageUrl,
                            local_img: "",
                            original_img: img || "",
                            status: "online",
                            source: "qanwat-live",
                            last_update: new Date().toLocaleString('ar-EG')
                        });
                    }
                }).catch(() => {
                    console.log(`❌ تخطي (رابط غير صالح)`);
                });
            }
        });
        
        // انتظار جميع الوعود
        await new Promise(resolve => setTimeout(resolve, 5000));
        
    } catch (err) {
        console.error(`❌ خطأ في كشط Qanwat-Live:`, err.message);
    }
    
    return channels;
}

/**
 * الدمج والتنفيذ الرئيسي
 */
async function startScraping() {
    try {
        console.log('🚀 بدأت عملية الكشط المجمعة...\n');
        
        // تجميع القنوات من كلا المصدرين
        const [arabStreamChannels, qanwatLiveChannels] = await Promise.all([
            scrapeArabStream(),
            scrapeQanwatLive()
        ]);
        
        const allChannels = [...arabStreamChannels, ...qanwatLiveChannels];
        
        // إزالة التكرارات (بناءً على الرابط)
        const uniqueChannels = allChannels.filter((channel, index, self) =>
            index === self.findIndex((c) => c.url === channel.url)
        );
        
        console.log(`\n📸 جاري معالجة صور ${uniqueChannels.length} قناة...`);
        
        // معالجة الصور
        for (let channel of uniqueChannels) {
            if (channel.original_img) {
                channel.local_img = await processImage(channel.original_img, channel.name);
            }
        }
        
        // حفظ ملف الـ JSON النهائي
        fs.writeFileSync(JSON_FILE, JSON.stringify(uniqueChannels, null, 2), 'utf-8');
        
        console.log(`\n✨ تم الانتهاء بنجاح!`);
        console.log(`📊 إحصائيات سريعة:`);
        console.log(`   - Arab-Stream: ${arabStreamChannels.length} قناة`);
        console.log(`   - Qanwat-Live: ${qanwatLiveChannels.length} قناة`);
        console.log(`   - إجمالي القنوات الفريدة: ${uniqueChannels.length} قناة`);
        console.log(`📁 الملف النهائي: ${JSON_FILE}`);
        
    } catch (err) {
        console.error('❌ خطأ فادح:', err.message);
    }
}

startScraping();
