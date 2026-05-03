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

async function getStreamUrl(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, { 
            timeout: 10000, 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } 
        });
        const $ = cheerio.load(data);
        const scripts = $('script').text();
        const m3u8Match = scripts.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)/);
        if (m3u8Match) return m3u8Match[1].replace(/\\/g, '');

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

async function processImage(imgUrl, channelName) {
    if (!imgUrl) return "";
    try {
        const safeName = channelName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_').toLowerCase();
        const fileName = `${safeName}.jpg`;
        const filePath = path.join(IMAGE_DIR, fileName);
        const response = await axios({ url: imgUrl, responseType: 'arraybuffer', timeout: 5000 });
        await sharp(response.data).resize(400, 225).jpeg({ quality: 85 }).toFile(filePath);
        return `${GITHUB_RAW_BASE}image/${fileName}`;
    } catch { return imgUrl || ""; }
}

async function startScraping() {
    const finalChannels = [];
    const currentTime = new Date().toLocaleString('ar-EG');
    
    // إعدادات المصادر المختلفة تماماً
    const sources = [
        { 
            name: 'ArabStream', 
            url: 'https://play.arab-stream.live/' 
        },
        { 
            name: 'QanwatLive', 
            url: 'https://www.qanwatlive.com/' 
        }
    ];

    for (const source of sources) {
        console.log(`\n🌐 بدأت استخراج القنوات من: ${source.name}`);
        try {
            const { data } = await axios.get(source.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $ = cheerio.load(data);
            let items = [];

            if (source.name === 'ArabStream') {
                // الهيكل الخاص بـ ArabStream: يعتمد على كلاس .channel
                $('.channel').each((i, el) => {
                    const name = $(el).find('span').text().trim();
                    const page = $(el).find('a').attr('href');
                    const img = $(el).find('img').attr('src');
                    const cat = $(el).closest('.channels').prev('.section-title').text().trim() || "عام";
                    if (name && page) items.push({ name, page, img, cat });
                });
            } 
            else if (source.name === 'QanwatLive') {
                // الهيكل الخاص بـ QanwatLive: يعتمد على كلاسات .card أو .post-card أو .blog-post
                $('.blog-post, .card, .post-card').each((i, el) => {
                    // سحب الاسم من رابط العنوان أو العنوان نفسه
                    const name = $(el).find('h2, .name, .post-title').text().trim();
                    const page = $(el).find('a').attr('href');
                    // سحب الصورة مع التحقق من وجود data-src (lazy load)
                    const img = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');
                    const cat = "بث مباشر";
                    if (name && page && page.includes('http')) items.push({ name, page, img, cat });
                });
            }

            for (const item of items) {
                const fullPageUrl = item.page.startsWith('http') ? item.page : source.url.replace(/\/$/, '') + '/' + item.page.replace(/^\//, '');
                
                console.log(`🔍 فحص [${source.name}]: ${item.name}`);
                const streamUrl = await getStreamUrl(fullPageUrl);
                
                if (streamUrl && await verifyVideo(streamUrl)) {
                    console.log(`✅ شغال!`);
                    const localImg = await processImage(item.img, item.name);
                    finalChannels.push({
                        name: item.name,
                        category: item.cat,
                        url: streamUrl,
                        server_url: fullPageUrl,
                        local_img: localImg,
                        original_img: item.img || "",
                        status: source.name, 
                        last_update: currentTime
                    });
                }
            }
        } catch (e) {
            console.log(`❌ خطأ في ${source.name}: ${e.message}`);
        }
    }

    fs.writeFileSync(JSON_FILE, JSON.stringify(finalChannels, null, 2), 'utf-8');
    console.log(`\n✨ تم الانتهاء! تم استخراج ${finalChannels.length} قناة من الموقعين.`);
}

startScraping();
