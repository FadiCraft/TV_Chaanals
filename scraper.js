const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');

// الإعدادات الأساسية
const IMAGE_DIR = './image';
const JSON_FILE = 'channels.json';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/FadiCraft/TV_Chaanals/refs/heads/main/';

// إنشاء مجلد الصور إذا لم يكن موجوداً
if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

/**
 * فحص دفق الفيديو باستخدام ffprobe
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
 * استخراج رابط m3u8 المباشر - النسخة المحسنة
 */
async function getStreamUrl(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, { 
            timeout: 10000, 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } 
        });

        const $ = cheerio.load(data);
        const scripts = $('script').text();
        
        // محاولة استخراج m3u8 من السكريبتات (للموقع الأول)
        const m3u8Match = scripts.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)/);
        if (m3u8Match) return m3u8Match[1].replace(/\\/g, '');

        // البحث المباشر في HTML
        const directMatch = data.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        if (directMatch) return directMatch[1];

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
 * معالجة وحفظ الصورة محلياً
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
 * كشط الموقع الأول: qanwatlive.com
 */
async function scrapeQanwatLive() {
    const channels = [];
    console.log('\n🌐 بدء كشط موقع qanwatlive.com...');
    
    try {
        const { data } = await axios.get('https://www.qanwatlive.com/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const $ = cheerio.load(data);
        
        // استخراج العناصر من هيكل الموقع الأول
        const items = [];
        $('.card, .post-card').each((i, el) => {
            const name = $(el).find('.name a').text().trim() || $(el).find('.name').text().trim();
            const page = $(el).find('a.post-link').attr('href') || $(el).find('a').attr('href');
            const img = $(el).find('img').attr('src');
            const cat = $(el).closest('.blog-section').find('.section-title').text().trim() || "بث مباشر";
            
            if (name && page) {
                items.push({ name, page, img, cat });
            }
        });

        console.log(`📊 تم العثور على ${items.length} قناة في الموقع الأول`);
        
        // معالجة كل قناة
        for (const item of items) {
            const fullPageUrl = item.page.startsWith('http') ? item.page : 'https://www.qanwatlive.com/' + item.page.replace(/^\//, '');
            
            console.log(`🔍 فحص: ${item.name}`);
            const streamUrl = await getStreamUrl(fullPageUrl);
            
            if (streamUrl && await verifyVideo(streamUrl)) {
                console.log(`✅ شغال! جاري حفظ البيانات...`);
                const localImg = await processImage(item.img, item.name);
                
                channels.push({
                    name: item.name,
                    category: item.cat,
                    url: streamUrl,
                    server_url: fullPageUrl,
                    local_img: localImg,
                    original_img: item.img || "",
                    status: "online",
                    source: "qanwatlive.com",
                    last_update: new Date().toLocaleString('ar-EG')
                });
            } else {
                console.log(`❌ تخطي (رابط غير صالح)`);
            }
        }
    } catch (e) {
        console.log(`❌ خطأ في موقع qanwatlive: ${e.message}`);
    }
    
    return channels;
}

/**
 * كشط الموقع الثاني: play.arab-stream.live
 */
async function scrapeArabStream() {
    const channels = [];
    console.log('\n🌐 بدء كشط موقع play.arab-stream.live...');
    
    try {
        const { data } = await axios.get('https://play.arab-stream.live/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const $ = cheerio.load(data);
        
        // استخراج العناصر من هيكل الموقع الثاني
        const elements = $('.channel');
        console.log(`📊 تم العثور على ${elements.length} قناة في الموقع الثاني`);
        
        for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            const name = $(el).find('span').text().trim();
            const href = $(el).find('a').attr('href');
            const img = $(el).find('img').attr('src');
            const cat = $(el).closest('.channels').prev('.section-title').text().trim() || "غير مصنف";
            
            if (name && href) {
                const fullPageUrl = href.startsWith('http') ? href : `https://play.arab-stream.live${href}`;
                
                console.log(`🔍 فحص: ${name}`);
                const streamUrl = await getStreamUrl(fullPageUrl);
                
                if (streamUrl && await verifyVideo(streamUrl)) {
                    console.log(`✅ شغال! جاري حفظ البيانات...`);
                    const localImg = await processImage(img, name);
                    
                    channels.push({
                        name: name,
                        category: cat,
                        url: streamUrl,
                        server_url: fullPageUrl,
                        local_img: localImg,
                        original_img: img || "",
                        status: "online",
                        source: "arab-stream.live",
                        last_update: new Date().toLocaleString('ar-EG')
                    });
                } else {
                    console.log(`❌ تخطي (رابط غير صالح)`);
                }
            }
        }
    } catch (e) {
        console.log(`❌ خطأ في موقع arab-stream: ${e.message}`);
    }
    
    return channels;
}

/**
 * الدالة الرئيسية لبدء الكشط من كلا الموقعين
 */
async function startScraping() {
    console.log('🚀 بدء عملية الكشط من كلا الموقعين...\n');
    
    // كشط كلا الموقعين بالتوازي لتوفير الوقت
    const [qanwatChannels, arabStreamChannels] = await Promise.all([
        scrapeQanwatLive(),
        scrapeArabStream()
    ]);
    
    // دمج القنوات من المصدرين
    const allChannels = [...qanwatChannels, ...arabStreamChannels];
    
    console.log(`\n📊 إحصائيات نهائية:`);
    console.log(`- قنوات qanwatlive.com: ${qanwatChannels.length}`);
    console.log(`- قنوات arab-stream.live: ${arabStreamChannels.length}`);
    console.log(`- المجموع الكلي: ${allChannels.length} قناة`);
    
    // حفظ جميع القنوات في ملف JSON واحد
    fs.writeFileSync(JSON_FILE, JSON.stringify(allChannels, null, 2), 'utf-8');
    console.log(`\n✨ تم حفظ جميع القنوات في ملف ${JSON_FILE} بنجاح!`);
}

// تشغيل السكريبت
startScraping();
