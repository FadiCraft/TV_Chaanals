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

async function downloadAndConvertImage(imgUrl, channelName) {
    try {
        const fileName = `${channelName.replace(/\s+/g, '_').toLowerCase()}.jpg`;
        const filePath = path.join(IMAGE_DIR, fileName);

        const response = await axios({
            url: imgUrl,
            responseType: 'arraybuffer'
        });

        // تحويل الصورة من webp أو أي صيغة أخرى إلى jpg وحفظها
        await sharp(response.data)
            .jpeg({ quality: 80 })
            .toFile(filePath);

        return `./image/${fileName}`;
    } catch (error) {
        console.error(`خطأ في معالجة صورة ${channelName}:`, error.message);
        return imgUrl; // العودة للرابط الأصلي في حال الفشل
    }
}

async function scrapeChannels() {
    try {
        const { data } = await axios.get(URL);
        const $ = cheerio.load(data);
        const results = [];

        // استهداف الأقسام (sections) والقنوات داخلها
        $('.section-title').each((i, section) => {
            const categoryName = $(section).text().trim();
            const channelsContainer = $(section).next('.channels');

            channelsContainer.find('.channel').each((j, el) => {
                const name = $(el).find('span').text().trim();
                const link = $(el).find('a').attr('href');
                const imgUrl = $(el).find('img').attr('src');

                results.push({
                    category: categoryName,
                    name: name,
                    url: link.startsWith('http') ? link : `https://play.arab-stream.live${link}`,
                    original_img: imgUrl,
                    local_img: '' // سيتم تحديثه لاحقاً
                });
            });
        });

        console.log(`تم العثور على ${results.length} قناة. جاري معالجة الصور...`);

        // معالجة الصور وتحديث المسارات
        for (let channel of results) {
            if (channel.original_img) {
                channel.local_img = await downloadAndConvertImage(channel.original_img, channel.name);
            }
        }

        // حفظ ملف JSON
        fs.writeFileSync(JSON_FILE, JSON.stringify(results, null, 2), 'utf-8');
        console.log('تم استخراج البيانات وحفظ الصور بنجاح.');

    } catch (error) {
        console.error('حدث خطأ أثناء الكشط:', error.message);
    }
}

scrapeChannels();
