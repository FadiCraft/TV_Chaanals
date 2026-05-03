const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const URL = 'https://play.arab-stream.live/';
const IMAGE_DIR = './image';
const JSON_FILE = 'channels.json';

// التأكد من وجود مجلد الصور
if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

/**
 * وظيفة تحميل الصورة وتحويلها إلى JPG
 */
async function downloadAndConvertImage(imgUrl, channelName) {
    try {
        // تنظيف اسم القناة لاستخدامه كاسم ملف
        const safeName = channelName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_').toLowerCase();
        const fileName = `${safeName}.jpg`;
        const filePath = path.join(IMAGE_DIR, fileName);

        const response = await axios({
            url: imgUrl,
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        await sharp(response.data)
            .jpeg({ quality: 85 })
            .toFile(filePath);

        return `./image/${fileName}`;
    } catch (error) {
        console.error(`❌ فشل معالجة صورة [${channelName}]:`, error.message);
        return imgUrl; // العودة للرابط الأصلي في حال الفشل
    }
}

/**
 * الوظيفة الأساسية للكشط
 */
async function scrapeChannels() {
    try {
        console.log('🚀 جاري بدء عملية الكشط...');
        const { data } = await axios.get(URL);
        const $ = cheerio.load(data);
        const results = [];

        // استخراج البيانات بناءً على هيكل الموقع
        $('.section-title').each((i, section) => {
            const categoryName = $(section).text().trim();
            const channelsContainer = $(section).next('.channels');

            channelsContainer.find('.channel').each((j, el) => {
                const name = $(el).find('span').text().trim();
                const link = $(el).find('a').attr('href');
                const imgUrl = $(el).find('img').attr('src');

                if (name && link) {
                    results.push({
                        category: categoryName,
                        name: name,
                        url: link.startsWith('http') ? link : `https://play.arab-stream.live${link}`,
                        original_img: imgUrl
                    });
                }
            });
        });

        console.log(`✅ تم العثور على ${results.length} قناة. جاري معالجة الصور الآن...`);

        // معالجة الصور بالتتابع لتجنب استهلاك الذاكرة العالي
        for (let channel of results) {
            if (channel.original_img) {
                channel.local_img = await downloadAndConvertImage(channel.original_img, channel.name);
            }
        }

        // حفظ ملف JSON النهائي
        fs.writeFileSync(JSON_FILE, JSON.stringify(results, null, 2), 'utf-8');
        console.log(`\n✨ انتهى العمل! تم حفظ البيانات في ${JSON_FILE}`);

    } catch (error) {
        console.error('❌ خطأ فادح في السكريبت:', error.message);
        process.exit(1);
    }
}

scrapeChannels();
