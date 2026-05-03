const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');

// دالة بسيطة للانتظار (Delay)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const BASE_URL = 'https://play.arab-stream.live/';
const IMAGE_DIR = './image';
const JSON_FILE = 'channels.json';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/FadiCraft/TV_Chaanals/refs/heads/main/';

// إعدادات axios الافتراضية لتبدو كمتصفح حقيقي
const axiosInstance = axios.create({
    timeout: 15000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ar,en-US;q=0.7,en;q=0.3',
    }
});

if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

async function verifyVideo(streamUrl) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(streamUrl, (err, metadata) => {
            if (err) resolve(false);
            else {
                const hasVideo = metadata.streams.some(s => s.codec_type === 'video');
                resolve(hasVideo);
            }
        });
    });
}

async function getStreamUrl(pageUrl) {
    try {
        const { data } = await axiosInstance.get(pageUrl);
        const match = data.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        return match ? match[1] : null;
    } catch (err) {
        if (err.response && err.response.status === 429) {
            console.error('⚠️ السيرفر أعطى خطأ 429 (طلبات كثيرة). سننتظر قليلاً...');
            await sleep(5000); // انتظر 5 ثواني إذا تم حظرك
        }
        return null;
    }
}

async function processImage(imgUrl, channelName) {
    try {
        const safeName = channelName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_').toLowerCase();
        const fileName = `${safeName}.jpg`;
        const filePath = path.join(IMAGE_DIR, fileName);
        const response = await axiosInstance({ url: imgUrl, responseType: 'arraybuffer' });
        await sharp(response.data).jpeg({ quality: 85 }).toFile(filePath);
        return `${GITHUB_RAW_BASE}image/${fileName}`;
    } catch {
        return imgUrl;
    }
}

async function startScraping() {
    try {
        console.log('🚀 بدأت عملية الفحص والتحقق...');
        const { data } = await axiosInstance.get(BASE_URL);
        const $ = cheerio.load(data);
        const workingChannels = [];
        const elements = $('.channel').toArray(); // تحويل لصفوف لتسهيل التعامل

        let currentId = 1;

        for (const el of elements) {
            const name = $(el).find('span').text().trim();
            const href = $(el).find('a').attr('href');
            const img = $(el).find('img').attr('src');

            if (name && href) {
                const fullPageUrl = href.startsWith('http') ? href : `https://play.arab-stream.live${href}`;
                
                console.log(`\n🔍 [ID: ${currentId}] فحص: ${name}`);
                
                // --- الحل الأساسي: إضافة انتظار 2 ثانية بين كل قناة وأخرى ---
                await sleep(2000); 

                const streamUrl = await getStreamUrl(fullPageUrl);

                if (streamUrl) {
                    const isLive = await verifyVideo(streamUrl);
                    if (isLive) {
                        console.log(`✅ شغال.`);
                        workingChannels.push({
                            id: currentId++,
                            name,
                            category: $(el).closest('.channels').prev('.section-title').text().trim() || "غير مصنف",
                            url: streamUrl,
                            local_img: await processImage(img, name),
                            original_img: img,
                            status: "online",
                            last_update: new Date().toLocaleString('ar-EG')
                        });
                    }
                }
            }
        }

        fs.writeFileSync(JSON_FILE, JSON.stringify(workingChannels, null, 2), 'utf-8');
        console.log(`\n✨ انتهى العمل! تم حفظ ${workingChannels.length} قناة.`);

    } catch (err) {
        console.error('❌ خطأ فادح:', err.message);
    }
}

startScraping();
