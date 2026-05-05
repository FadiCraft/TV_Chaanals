const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');

const IMAGE_DIR = './image';
const JSON_FILE = 'channels_yalla.json';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/FadiCraft/TV_Chaanals/refs/heads/main/';
const BASE_URL = 'https://www.yallatv.online'; // الدومين الجديد

if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

/**
 * فحص دفق الفيديو باستخدام ffprobe
 */
async function verifyVideo(streamUrl) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(streamUrl, ["-connect_timeout", "5", "-timeout", "5000000"], (err, metadata) => {
            if (err) resolve(false);
            else {
                const hasVideo = metadata.streams.some(s => s.codec_type === 'video');
                resolve(hasVideo);
            }
        });
    });
}

/**
 * استخراج رابط m3u8 من صفحة المشاهدة
 */
async function getStreamUrl(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, { 
            timeout: 10000, 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': BASE_URL
            } 
        });

        const $ = cheerio.load(data);
        
        // البحث عن الـ iframe الخاص بالفيديو
        const iframeSrc = $('.iframevideo').attr('src');
        if (!iframeSrc) {
            console.log(`   ⚠️ لم يتم العثور على وسام iframe في هذه الصفحة.`);
            return null;
        }

        // بناء رابط الـ iframe الكامل
        const fullIframeUrl = iframeSrc.startsWith('http') ? iframeSrc : BASE_URL + iframeSrc;
        console.log(`   📡 جاري فحص سيرفر المشاهدة: ${fullIframeUrl}`);

        // جلب محتوى السيرفر للبحث عن ملف m3u8
        const iframeRes = await axios.get(fullIframeUrl, { 
            timeout: 8000, 
            headers: { 
                'User-Agent': 'Mozilla/5.0', 
                'Referer': pageUrl 
            } 
        });

        const m3u8Matches = iframeRes.data.match(/https?:\/\/[^"']+\.m3u8[^"']*/g);
        
        if (m3u8Matches) {
            const uniqueLinks = [...new Set(m3u8Matches)].map(l => l.replace(/\\/g, ''));
            for (const link of uniqueLinks) {
                console.log(`   🔍 فحص الرابط المباشر: ${link.substring(0, 50)}...`);
                if (await verifyVideo(link)) return link;
            }
        }
        
        return null;
    } catch (e) { 
        console.log(`   ❌ خطأ أثناء استخراج السيرفر: ${e.message}`);
        return null; 
    }
}

/**
 * معالجة وتصغير الشعار
 */
async function processImage(imgUrl, channelName) {
    if (!imgUrl) return "";
    try {
        const safeName = channelName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_').toLowerCase();
        const fileName = `${safeName}.webp`; // الموقع يستخدم webp
        const filePath = path.join(IMAGE_DIR, fileName);

        let finalImgUrl = imgUrl.startsWith('http') ? imgUrl : BASE_URL + imgUrl;

        const response = await axios({ url: finalImgUrl, responseType: 'arraybuffer', timeout: 5000 });
        await sharp(response.data)
            .resize(400, 225)
            .toFile(filePath);

        return `${GITHUB_RAW_BASE}image/${fileName}`;
    } catch { return ""; }
}

async function startScraping() {
    const finalChannels = [];
    const currentTime = new Date().toLocaleString('ar-EG');
    
    // يمكنك إضافة المزيد من الروابط هنا (أقسام الموقع)
    const sections = [
        'https://www.yallatv.online/amp/'
    ];

    for (const sectionUrl of sections) {
        console.log(`\n🌐 جاري استخراج القنوات من القسم: ${sectionUrl}`);
        try {
            const { data } = await axios.get(sectionUrl, { 
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' } 
            });
            
            const $ = cheerio.load(data);
            const channelElements = $('.channels-grid a.channel').toArray();

            console.log(`✅ تم العثور على ${channelElements.length} قناة محتملة.`);

            for (const el of channelElements) {
                const name = $(el).find('.channel-name').text().trim();
                let pageLink = $(el).attr('href');
                let imgPath = $(el).find('amp-img img').attr('src') || $(el).find('amp-img').attr('src');

                if (!pageLink) continue;
                if (!pageLink.startsWith('http')) pageLink = BASE_URL + pageLink;

                console.log(`\n📺 [${name}]`);
                console.log(`   🔗 صفحة القناة: ${pageLink}`);

                const streamUrl = await getStreamUrl(pageLink);
                
                if (streamUrl) {
                    console.log(`   ✅ تم العثور على رابط مباشر شغال!`);
                    const localImg = await processImage(imgPath, name);
                    
                    finalChannels.push({
                        name: name,
                        url: streamUrl,
                        img: localImg,
                        server: pageLink,
                        last_update: currentTime
                    });
                } else {
                    console.log(`   ❌ لا يوجد رابط m3u8 يعمل حالياً.`);
                }
            }
        } catch (e) { 
            console.log(`❌ فشل الوصول للموقع: ${e.message}`);
            console.log(`💡 نصيحة: إذا استمرت المشكلة، قد تحتاج لاستخدام puppeteer لتخطي Cloudflare.`);
        }
    }

    fs.writeFileSync(JSON_FILE, JSON.stringify(finalChannels, null, 2));
    console.log(`\n✨ العمل اكتمل! تم حفظ ${finalChannels.length} قناة في ملف ${JSON_FILE}`);
}

startScraping();
