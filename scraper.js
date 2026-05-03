const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');

const URL = 'https://play.arab-stream.live/';
const IMAGE_DIR = './image';
const JSON_FILE = 'channels.json';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/FadiCraft/TV_Chaanals/refs/heads/main/';

if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

/**
 * فحص رابط البث (m3u8/mp4) للتأكد من وجود دفق فيديو حقيقي
 */
function verifyVideoStream(streamUrl) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(streamUrl, (err, metadata) => {
            if (err) {
                resolve(false);
            } else {
                // التأكد من وجود مسار فيديو (video stream) داخل الرابط
                const hasVideo = metadata.streams.some(s => s.codec_type === 'video');
                resolve(hasVideo);
            }
        });
    });
}

/**
 * استخراج رابط البث المباشر من صفحة السيرفر
 */
async function extractStreamUrl(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, { timeout: 8000 });
        // البحث عن روابط m3u8 داخل كود الصفحة أو الأكواد البرمجية
        const m3u8Match = data.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        return m3u8Match ? m3u8Match[1] : null;
    } catch {
        return null;
    }
}

async function downloadAndConvertImage(imgUrl, channelName) {
    try {
        const safeName = channelName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_').toLowerCase();
        const fileName = `${safeName}.jpg`;
        const filePath = path.join(IMAGE_DIR, fileName);
        const response = await axios({ url: imgUrl, responseType: 'arraybuffer' });
        await sharp(response.data).jpeg({ quality: 85 }).toFile(filePath);
        return `${GITHUB_RAW_BASE}image/${fileName}`;
    } catch {
        return imgUrl;
    }
}

async function scrapeChannels() {
    try {
        console.log('🚀 بدء الفحص العميق لروابط الفيديو...');
        const { data } = await axios.get(URL);
        const $ = cheerio.load(data);
        const results = [];

        const channelElements = $('.channel');

        for (let i = 0; i < channelElements.length; i++) {
            const el = channelElements[i];
            const name = $(el).find('span').text().trim();
            const pageLink = $(el).find('a').attr('href');
            const imgUrl = $(el).find('img').attr('src');

            if (name && pageLink) {
                const fullPageUrl = pageLink.startsWith('http') ? pageLink : `https://play.arab-stream.live${pageLink}`;
                
                console.log(`🔍 جاري البحث عن رابط البث لـ: ${name}`);
                const streamUrl = await extractStreamUrl(fullPageUrl);

                if (streamUrl) {
                    console.log(`📽️ تم العثور على رابط، جاري فحص جودة البث...`);
                    const isLive = await verifyVideoStream(streamUrl);

                    if (isLive) {
                        results.push({
                            name,
                            category: $(el).closest('.channels').prev('.section-title').text().trim(),
                            stream_url: streamUrl,
                            page_url: fullPageUrl,
                            live: true,
                            original_img: imgUrl
                        });
                        console.log(`✅ القناة شغال بثها حالياً: ${name}`);
                    } else {
                        console.log(`⚠️ الرابط موجود ولكن لا يوجد دفق فيديو (OFFLINE): ${name}`);
                    }
                } else {
                    console.log(`❌ لم يتم العثور على رابط بث في الصفحة: ${name}`);
                }
            }
        }

        console.log('\n📸 جاري معالجة الصور...');
        for (let channel of results) {
            channel.local_img = await downloadAndConvertImage(channel.original_img, channel.name);
        }

        fs.writeFileSync(JSON_FILE, JSON.stringify(results, null, 2), 'utf-8');
        console.log(`✨ تم تحديث ${results.length} قناة شغالة فعلياً.`);

    } catch (error) {
        console.error('❌ خطأ:', error.message);
    }
}

scrapeChannels();
