const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const BASE_URL = 'https://www.yallatv.online';
const START_URL = 'https://www.yallatv.online/amp/';
const IMG_DIR = './image';

// التأكد من وجود مجلد الصور
if (!fs.existsSync(IMG_DIR)) {
    fs.mkdirSync(IMG_DIR, { recursive: true });
}

async function scrape() {
    try {
        console.log('🚀 بدء عملية الفحص...');
        const { data } = await axios.get(START_URL, { timeout: 10000 });
        const $ = cheerio.load(data);
        
        const channelsData = [];
        const channels = $('.channels-grid a.channel');

        for (let i = 0; i < channels.length; i++) {
            const el = channels[i];
            const name = $(el).find('.channel-name').text().trim();
            const relPath = $(el).attr('href');
            const relImg = $(el).find('amp-img').attr('src') || $(el).find('img').attr('src');

            if (!relPath) continue;

            const channelPageUrl = new URL(relPath, BASE_URL).href;
            const imageUrl = new URL(relImg, BASE_URL).href;
            const imageName = `${path.basename(relImg, path.extname(relImg))}.jpg`;
            const imagePath = path.join(IMG_DIR, imageName);

            try {
                // 1. جلب رابط البث المباشر من الصفحة الداخلية
                const chResponse = await axios.get(channelPageUrl, { timeout: 10000 });
                const $ch = cheerio.load(chResponse.data);
                const iframeSrc = $ch('iframe.iframevideo').attr('src');
                
                if (!iframeSrc) {
                    console.log(`⚠️ تخطي ${name}: لم يتم العثور على سيرفر.`);
                    continue;
                }

                const directStreamUrl = new URL(iframeSrc, BASE_URL).href;

                // 2. تحميل ومعالجة الصورة باستخدام Sharp (لتحسينها لتطبيقك)
                const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                await sharp(imgResponse.data)
                    .resize(320, 180) // تغيير الحجم ليكون مناسباً لـ Android TV
                    .jpeg({ quality: 80 })
                    .toFile(imagePath);

                channelsData.push({
                    id: i + 1,
                    name: name,
                    image: `image/${imageName}`,
                    stream_url: directStreamUrl,
                    category: "MBC", // يمكنك استخراج القسم ديناميكياً إذا أردت
                    updated_at: new Date().toISOString()
                });

                console.log(`✅ تم بنجاح: ${name}`);

            } catch (err) {
                console.error(`❌ خطأ في القناة ${name}:`, err.message);
            }
        }

        // 3. حفظ البيانات في ملف JSON
        fs.writeFileSync('channels.json', JSON.stringify(channelsData, null, 4));
        console.log(`\n🎉 اكتمل العمل! تم حفظ ${channelsData.length} قناة في channels.json`);

    } catch (error) {
        console.error('🔴 خطأ فادح في السكريبت:', error.message);
        process.exit(1);
    }
}

scrape();
