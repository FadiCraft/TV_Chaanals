const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const URL = 'https://play.arab-stream.live/';
const IMAGE_DIR = './image';
const JSON_FILE = 'channels.json';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/FadiCraft/TV_Chaanals/refs/heads/main/';

if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

/**
 * فحص الرابط للتأكد من أنه يعمل
 */
async function isUrlWorking(url) {
    try {
        const response = await axios.get(url, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        return response.status === 200;
    } catch (error) {
        return false;
    }
}

/**
 * تحميل وتحويل الصورة والحصول على رابط GitHub الكامل
 */
async function downloadAndConvertImage(imgUrl, channelName) {
    try {
        const safeName = channelName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_').toLowerCase();
        const fileName = `${safeName}.jpg`;
        const filePath = path.join(IMAGE_DIR, fileName);

        const response = await axios({
            url: imgUrl,
            responseType: 'arraybuffer',
            timeout: 10000
        });

        await sharp(response.data).jpeg({ quality: 85 }).toFile(filePath);

        // إرجاع الرابط الكامل على GitHub
        return `${GITHUB_RAW_BASE}image/${fileName}`;
    } catch (error) {
        console.error(`❌ فشل معالجة صورة [${channelName}]`);
        return imgUrl; 
    }
}

async function scrapeChannels() {
    try {
        console.log('🚀 بدء العمل...');
        const { data } = await axios.get(URL);
        const $ = cheerio.load(data);
        const results = [];

        const sections = $('.section-title');

        for (let i = 0; i < sections.length; i++) {
            const categoryName = $(sections[i]).text().trim();
            const channels = $(sections[i]).next('.channels').find('.channel');

            for (let j = 0; j < channels.length; j++) {
                const el = channels[j];
                const name = $(el).find('span').text().trim();
                let link = $(el).find('a').attr('href');
                const imgUrl = $(el).find('img').attr('src');

                if (name && link) {
                    const fullLink = link.startsWith('http') ? link : `https://play.arab-stream.live${link}`;
                    
                    console.log(`🔍 فحص القناة: ${name}`);
                    const working = await isUrlWorking(fullLink);

                    if (working) {
                        results.push({
                            category: categoryName,
                            name: name,
                            url: fullLink,
                            status: "working",
                            original_img: imgUrl
                        });
                    } else {
                        console.log(`⚠️ تخطي القناة (الرابط لا يعمل): ${name}`);
                    }
                }
            }
        }

        console.log(`✅ تم إيجاد ${results.length} قناة تعمل. جاري معالجة الصور...`);

        for (let channel of results) {
            if (channel.original_img) {
                channel.local_img = await downloadAndConvertImage(channel.original_img, channel.name);
            }
        }

        fs.writeFileSync(JSON_FILE, JSON.stringify(results, null, 2), 'utf-8');
        console.log(`✨ تم التحديث بنجاح!`);

    } catch (error) {
        console.error('❌ خطأ:', error.message);
    }
}

scrapeChannels();
