const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');

const IMAGE_DIR = './image';
const JSON_FILE = 'channels.json';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/FadiCraft/TV_Chaanals/refs/heads/main/';

if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

let idCounter = 1;

// فحص الفيديو للتأكد من أن الرابط شغال فعلياً
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

// استخراج الرابط المباشر مع مراعاة نظام الفريمات في الموقع الثاني
async function getStreamUrl(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        let contentToSearch = data;

        // فحص وجود فريم (خاص بالموقع الثاني qanwatlive)
        const $ = cheerio.load(data);
        const iframeSrc = $('iframe#iframe').attr('src');

        if (iframeSrc) {
            try {
                const iframeRes = await axios.get(iframeSrc, { 
                    timeout: 7000, 
                    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': pageUrl } 
                });
                contentToSearch = iframeRes.data;
            } catch (e) { /* استمر في البحث في الصفحة الأساسية لو فشل الفريم */ }
        }

        // استخراج رابط m3u8
        const match = contentToSearch.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        return match ? match[1].replace(/\\/g, '') : null;
    } catch (e) { return null; }
}

async function processImage(imgUrl) {
    if (!imgUrl) return "";
    try {
        if (imgUrl.toLowerCase().includes('.webp')) {
            const fileName = `img_${idCounter}.jpg`;
            const filePath = path.join(IMAGE_DIR, fileName);
            const response = await axios({ url: imgUrl, responseType: 'arraybuffer' });
            await sharp(response.data).jpeg().toFile(filePath);
            return `${GITHUB_RAW_BASE}image/${fileName}`;
        }
        return imgUrl;
    } catch { return imgUrl; }
}

async function startScraping() {
    let allFoundChannels = [];
    
    // --- المصدر الأول: Arab Stream ---
    try {
        console.log("📡 كشط الموقع الأول...");
        const res1 = await axios.get('https://play.arab-stream.live/');
        const $1 = cheerio.load(res1.data);
        $1('.channel').each((i, el) => {
            allFoundChannels.push({
                name: $1(el).find('span').text().trim(),
                page: $1(el).find('a').attr('href'),
                img: $1(el).find('img').attr('src'),
                cat: $1(el).closest('.channels').prev('.section-title').text().trim()
            });
        });
    } catch (e) { console.log("خطأ في الموقع الأول"); }

    // --- المصدر الثاني: Qanwat Live ---
    try {
        console.log("📡 كشط الموقع الثاني...");
        const res2 = await axios.get('https://www.qanwatlive.com/');
        const $2 = cheerio.load(res2.data);
        $2('.card').each((i, el) => {
            allFoundChannels.push({
                name: $2(el).find('.name a').text().trim(),
                page: $2(el).find('.card-image a').attr('href'),
                img: $2(el).find('img').attr('src'),
                cat: $2(el).closest('.blog-section').attr('data-category') || "قنوات متنوعة"
            });
        });
    } catch (e) { console.log("خطأ في الموقع الثاني"); }

    const results = [];

    for (const item of allFoundChannels) {
        if (!item.page) continue;
        console.log(`🔍 فحص قناة: ${item.name}`);
        
        const streamUrl = await getStreamUrl(item.page);
        
        if (streamUrl && await verifyVideo(streamUrl)) {
            const finalImg = await processImage(item.img);
            results.push({
                id: idCounter++,
                name: item.name,
                category: item.cat,
                url: streamUrl,
                image: finalImg
            });
            console.log(`✅ تمت الإضافة`);
        }
    }

    fs.writeFileSync(JSON_FILE, JSON.stringify(results, null, 2));
    console.log(`🏁 انتهى! تم حفظ ${results.length} قناة بنجاح.`);
}

startScraping();
