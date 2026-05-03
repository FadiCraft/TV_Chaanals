const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const BASE_URL = 'https://www.yallatv.online';
const START_URL = 'https://www.yallatv.online/amp/';
const IMG_DIR = './image';

// إعداد الترويسات لمحاكاة متصفح حقيقي
const axiosConfig = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ar,en-US;q=0.7,en;q=0.3',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': 'https://www.google.com/'
    },
    timeout: 15000
};

if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

async function scrape() {
    try {
        console.log('🚀 محاولة الاتصال بالموقع مع محاكاة متصفح...');
        
        // استخدام axiosConfig في كل طلب
        const { data } = await axios.get(START_URL, axiosConfig);
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
                // جلب صفحة القناة مع الترويسات
                const chResponse = await axios.get(channelPageUrl, axiosConfig);
                const $ch = cheerio.load(chResponse.data);
                const iframeSrc = $ch('iframe.iframevideo').attr('src');
                
                if (!iframeSrc) continue;

                const directStreamUrl = new URL(iframeSrc, BASE_URL).href;

                // تحميل الصورة
                const imgResponse = await axios.get(imageUrl, { ...axiosConfig, responseType: 'arraybuffer' });
                await sharp(imgResponse.data)
                    .resize(320, 180)
                    .jpeg({ quality: 80 })
                    .toFile(imagePath);

                channelsData.push({
                    id: i + 1,
                    name: name,
                    image: `image/${imageName}`,
                    stream_url: directStreamUrl,
                    updated_at: new Date().toISOString()
                });

                console.log(`✅ تم جلب: ${name}`);

                // إضافة تأخير بسيط (Delay) لتجنب الحظر أثناء التنقل بين الصفحات
                await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (err) {
                console.error(`❌ خطأ في ${name}: status ${err.response?.status || err.message}`);
            }
        }

        fs.writeFileSync('channels.json', JSON.stringify(channelsData, null, 4));
        console.log(`🎉 تم تحديث البيانات بنجاح.`);

    } catch (error) {
        if (error.response?.status === 403) {
            console.error('🔴 الموقع لا يزال يحظر الطلب (403). قد يحتاج إلى Cloudflare Solver أو Puppeteer.');
        } else {
            console.error('🔴 خطأ فادح:', error.message);
        }
        process.exit(1);
    }
}

scrape();
