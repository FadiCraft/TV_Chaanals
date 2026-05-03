const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');

// دالة بسيطة للانتظار (Delay)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// الموقعين
const SITE1_URL = 'https://play.arab-stream.live/';
const SITE2_URL = 'https://www.qanwatlive.com/';

const IMAGE_DIR = './image';
const JSON_FILE = 'channels.json';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/FadiCraft/TV_Chaanals/refs/heads/main/';

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

// استخراج رابط البث من الموقع الأول (arab-stream)
async function getStreamUrlSite1(pageUrl) {
    try {
        const { data } = await axiosInstance.get(pageUrl);
        const match = data.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        return match ? match[1] : null;
    } catch (err) {
        if (err.response && err.response.status === 429) {
            console.error('⚠️ السيرفر أعطى خطأ 429 (طلبات كثيرة). سننتظر قليلاً...');
            await sleep(5000);
        }
        return null;
    }
}

// استخراج رابط البث من الموقع الثاني (qanwatlive)
async function getStreamUrlSite2(pageUrl) {
    try {
        const { data } = await axiosInstance.get(pageUrl);
        
        // نبحث عن iframe اللي فيه رابط المشغل
        const iframeMatch = data.match(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/i);
        if (!iframeMatch) {
            console.log('   ⚠️ لم يتم العثور على iframe');
            return null;
        }
        
        const iframeUrl = iframeMatch[1];
        console.log(`   📺 تم العثور على iframe: ${iframeUrl}`);
        
        // نفتح صفحة iframe
        const iframeData = await axiosInstance.get(iframeUrl);
        
        // نبحث عن رابط m3u8 في صفحة iframe
        const m3u8Match = iframeData.data.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        if (m3u8Match) {
            return m3u8Match[1];
        }
        
        // نبحث عن رابط في ملف JS
        const jsMatch = iframeData.data.match(/source:\s*["']([^"']+\.m3u8[^"']*)["']/);
        if (jsMatch) {
            return jsMatch[1];
        }
        
        // نبحث عن أي رابط يحتوي على m3u8
        const anyM3u8 = iframeData.data.match(/(https?:\/\/[^\s"']+\.m3u8[^\s"']*)/);
        return anyM3u8 ? anyM3u8[1] : null;
        
    } catch (err) {
        if (err.response && err.response.status === 429) {
            console.error('⚠️ السيرفر أعطى خطأ 429 (طلبات كثيرة). سننتظر قليلاً...');
            await sleep(5000);
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

// استخراج قنوات من الموقع الأول (arab-stream)
async function scrapeSite1() {
    console.log('\n🌐 ========== بدء استخراج الموقع الأول: arab-stream.live ==========');
    const channels = [];
    
    try {
        const { data } = await axiosInstance.get(SITE1_URL);
        const $ = cheerio.load(data);
        const elements = $('.channel').toArray();

        for (const el of elements) {
            const name = $(el).find('span').text().trim();
            const href = $(el).find('a').attr('href');
            const img = $(el).find('img').attr('src');

            if (name && href) {
                const fullPageUrl = href.startsWith('http') ? href : `https://play.arab-stream.live${href}`;
                
                console.log(`\n🔍 فحص: ${name}`);
                await sleep(2000);

                const streamUrl = await getStreamUrlSite1(fullPageUrl);

                if (streamUrl) {
                    const isLive = await verifyVideo(streamUrl);
                    if (isLive) {
                        console.log(`✅ شغال.`);
                        const category = $(el).closest('.channels').prev('.section-title').text().trim() || "غير مصنف";
                        
                        channels.push({
                            name,
                            category,
                            url: streamUrl,
                            original_img: img,
                            source: 'arab-stream.live'
                        });
                    }
                }
            }
        }
    } catch (err) {
        console.error('❌ خطأ في الموقع الأول:', err.message);
    }
    
    return channels;
}

// استخراج قنوات من الموقع الثاني (qanwatlive)
async function scrapeSite2() {
    console.log('\n🌐 ========== بدء استخراج الموقع الثاني: qanwatlive.com ==========');
    const channels = [];
    
    try {
        const { data } = await axiosInstance.get(SITE2_URL);
        const $ = cheerio.load(data);
        
        // نبحث عن جميع أقسام القنوات
        const sections = $('.widget.HTML').toArray();
        
        for (const section of sections) {
            // استخراج اسم القسم
            const categoryTitle = $(section).find('h3.title').text().trim();
            console.log(`\n📂 القسم: ${categoryTitle}`);
            
            // استخراج القنوات في هذا القسم
            const cards = $(section).find('.card').toArray();
            
            for (const card of cards) {
                const linkElement = $(card).find('a.post-link');
                const name = linkElement.text().trim();
                const href = linkElement.attr('href');
                const img = $(card).find('img.card-img').attr('src');
                
                if (name && href) {
                    const fullPageUrl = href.startsWith('http') ? href : `https://www.qanwatlive.com${href}`;
                    
                    console.log(`\n🔍 فحص: ${name}`);
                    await sleep(2000);
                    
                    const streamUrl = await getStreamUrlSite2(fullPageUrl);
                    
                    if (streamUrl) {
                        const isLive = await verifyVideo(streamUrl);
                        if (isLive) {
                            console.log(`✅ شغال.`);
                            channels.push({
                                name,
                                category: categoryTitle || "غير مصنف",
                                url: streamUrl,
                                original_img: img,
                                source: 'qanwatlive.com'
                            });
                        } else {
                            console.log(`❌ البث غير متاح حالياً.`);
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.error('❌ خطأ في الموقع الثاني:', err.message);
    }
    
    return channels;
}

async function startScraping() {
    try {
        console.log('🚀 بدأت عملية الفحص والتحقق من كلا الموقعين...');
        
        // استخراج من كلا الموقعين
        const [site1Channels, site2Channels] = await Promise.all([
            scrapeSite1(),
            scrapeSite2()
        ]);
        
        // دمج القنوات من الموقعين
        let allChannels = [...site1Channels, ...site2Channels];
        
        // إزالة القنوات المكررة (بناءً على الرابط)
        const uniqueChannels = [];
        const seenUrls = new Set();
        
        for (const channel of allChannels) {
            if (!seenUrls.has(channel.url)) {
                seenUrls.add(channel.url);
                uniqueChannels.push(channel);
            }
        }
        
        // إضافة id ومعالجة الصور
        const workingChannels = [];
        let currentId = 1;
        
        for (const channel of uniqueChannels) {
            workingChannels.push({
                id: currentId++,
                name: channel.name,
                category: channel.category,
                url: channel.url,
                local_img: await processImage(channel.original_img, channel.name),
                original_img: channel.original_img,
                status: "online",
                source: channel.source,
                last_update: new Date().toLocaleString('ar-EG')
            });
        }

        fs.writeFileSync(JSON_FILE, JSON.stringify(workingChannels, null, 2), 'utf-8');
        
        console.log('\n📊 ========== إحصائيات ==========');
        console.log(`📺 ${workingChannels.length} قناة شغالة من مجموع ${allChannels.length} قناة`);
        console.log(`📁 تم حفظ النتائج في: ${JSON_FILE}`);
        
        // إحصائيات حسب المصدر
        const site1Count = workingChannels.filter(c => c.source === 'arab-stream.live').length;
        const site2Count = workingChannels.filter(c => c.source === 'qanwatlive.com').length;
        console.log(`   - من arab-stream.live: ${site1Count} قناة`);
        console.log(`   - من qanwatlive.com: ${site2Count} قناة`);

    } catch (err) {
        console.error('❌ خطأ فادح:', err.message);
    }
}

startScraping();
