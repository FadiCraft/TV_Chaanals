const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');

// الإعدادات الأساسية
const BASE_URL = 'https://play.arab-stream.live/';
const IMAGE_DIR = './image1';
const JSON_FILE = 'channels1.json';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/FadiCraft/TV_Chaanals/refs/heads/main/';

// إنشاء مجلد الصور إذا لم يكن موجوداً
if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

/**
 * وظيفة فحص دفق الفيديو (Stream Check)
 * تستخدم ffprobe للتأكد من أن الرابط يرسل بيانات فيديو حقيقية
 */
async function verifyVideo(streamUrl) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(streamUrl, (err, metadata) => {
            if (err) {
                resolve(false); // الرابط لا يعمل أو ليس رابط فيديو
            } else {
                // التأكد من وجود تراكم بيانات فيديو (Video Stream)
                const hasVideo = metadata.streams.some(s => s.codec_type === 'video');
                resolve(hasVideo);
            }
        });
    });
}

/**
 * استخراج رابط m3u8 المباشر من صفحة السيرفر
 */
async function getStreamUrl(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, { 
            timeout: 10000, 
            headers: { 'User-Agent': 'Mozilla/5.0' } 
        });
        // البحث عن روابط m3u8 داخل كود الصفحة
        const match = data.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

/**
 * تحميل الصورة وتحويلها إلى JPG وحفظها محلياً
 */
async function processImage(imgUrl, channelName) {
    try {
        const safeName = channelName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_').toLowerCase();
        const fileName = `${safeName}.jpg`;
        const filePath = path.join(IMAGE_DIR, fileName);

        const response = await axios({ url: imgUrl, responseType: 'arraybuffer' });
        await sharp(response.data).jpeg({ quality: 85 }).toFile(filePath);

        return `${GITHUB_RAW_BASE}image1/${fileName}`;
    } catch {
        return imgUrl; // في حال الفشل نعود للرابط الأصلي
    }
}

/**
 * السكريبت الأساسي
 */
async function startScraping() {
    try {
        console.log('🚀 بدأت عملية الفحص والتحقق...');
        const { data } = await axios.get(BASE_URL);
        const $ = cheerio.load(data);
        const workingChannels = [];

        const elements = $('.channel');

        for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            const name = $(el).find('span').text().trim();
            const href = $(el).find('a').attr('href');
            const img = $(el).find('img').attr('src');

            if (name && href) {
                const fullPageUrl = href.startsWith('http') ? href : `https://play.arab-stream.live${href}`;
                
                console.log(`\n🔍 فحص القناة [${name}]...`);
                const streamUrl = await getStreamUrl(fullPageUrl);

                if (streamUrl) {
                    console.log(`📡 وجدنا رابط بث، نختبر الفيديو الآن...`);
                    const isLive = await verifyVideo(streamUrl);

                    if (isLive) {
                        console.log(`✅ فيديو شغال بنجاح!`);
                        workingChannels.push({
                            name,
                            category: $(el).closest('.channels').prev('.section-title').text().trim() || "غير مصنف",
                            url: streamUrl,
                            local_img: "", // سيتم تعبئته لاحقاً
                            original_img: img,
                            status: "online",
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

        console.log(`\n📸 جاري معالجة صور ${workingChannels.length} قناة...`);
        for (let channel of workingChannels) {
            channel.local_img = await processImage(channel.original_img, channel.name);
        }

        // حفظ ملف الـ JSON النهائي
        fs.writeFileSync(JSON_FILE, JSON.stringify(workingChannels, null, 2), 'utf-8');
        console.log(`\n✨ انتهى العمل! تم تحديث ${JSON_FILE} بالقنوات الشغالة فقط.`);

    } catch (err) {
        console.error('❌ خطأ فادح:', err.message);
    }
}

startScraping();
