const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');

// تفعيل ميزة التخفي لتجاوز Cloudflare
puppeteer.use(StealthPlugin());

const IMAGE_DIR = './image';
const JSON_FILE = 'channels_yalla.json';
const BASE_URL = 'https://www.yallatv.online';

if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

/**
 * دالة استخراج الرابط المباشر عبر مراقبة الشبكة
 */
async function getStreamFromNetwork(pageUrl) {
    const browser = await puppeteer.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080'] 
    });
    
    const page = await browser.newPage();
    let streamUrl = null;

    try {
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // تفعيل اعتراض طلبات الشبكة للبحث عن روابط البث
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            // البحث عن الروابط التي تنتهي بـ m3u8 أو تحتوي على دومين akamaized المعروف للبث
            if (url.includes('.m3u8') || url.includes('akamaized.net')) {
                console.log(`   🎯 تم التقاط رابط بث: ${url.substring(0, 60)}...`);
                streamUrl = url;
            }
            request.continue();
        });

        console.log(`   🌐 جاري فحص صفحة البث: ${pageUrl}`);
        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // الانتظار للتأكد من تشغيل المشغل (Iframe)
        await page.waitForSelector('.iframevideo', { timeout: 15000 }).catch(() => {});
        
        // مهلة إضافية لضمان خروج طلب الـ m3u8 من المشغل
        await new Promise(r => setTimeout(r, 10000)); 

    } catch (e) {
        console.log(`   ❌ فشل استخراج الرابط من الشبكة: ${e.message}`);
    } finally {
        await browser.close();
    }
    return streamUrl;
}

/**
 * معالجة وحفظ شعار القناة
 */
async function processImage(imgUrl, channelName) {
    if (!imgUrl) return "";
    try {
        const safeName = channelName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_').toLowerCase();
        const fileName = `${safeName}.webp`;
        const filePath = path.join(IMAGE_DIR, fileName);

        const response = await axios({ url: imgUrl, responseType: 'arraybuffer', timeout: 5000 });
        await sharp(response.data).resize(400, 225).toFile(filePath);
        
        // تأكد من تغيير اسم المستخدم والمستودع هنا إذا لزم الأمر
        return `https://raw.githubusercontent.com/FadiCraft/TV_Chaanals/main/image/${fileName}`;
    } catch (e) {
        return imgUrl; // في حال الفشل نستخدم الرابط الأصلي
    }
}

async function startScraping() {
    console.log("🚀بدء عملية الاستخراج...");
    const finalChannels = [];
    const browser = await puppeteer.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();

    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        console.log(`\n🔎 جاري سحب قائمة القنوات من: ${BASE_URL}/amp/`);
        await page.goto(`${BASE_URL}/amp/`, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // الانتظار حتى تظهر الشبكة التي تحتوي على القنوات
        await page.waitForSelector('.channels-grid', { timeout: 20000 });

        const content = await page.content();
        const $ = cheerio.load(content);
        
        const items = [];
        $('.channels-grid a.channel').each((i, el) => {
            const name = $(el).find('.channel-name').text().trim();
            const href = $(el).attr('href');
            let img = $(el).find('amp-img img').attr('src') || $(el).find('amp-img').attr('src') || $(el).find('img').attr('src');

            if (href && name) {
                items.push({
                    name,
                    page: href.startsWith('http') ? href : BASE_URL + href,
                    img: img ? (img.startsWith('http') ? img : BASE_URL + img) : ""
                });
            }
        });

        console.log(`✅ تم العثور على ${items.length} قناة.`);
        await browser.close();

        // فحص كل قناة لاستخراج الرابط المباشر
        for (const item of items) {
            console.log(`\n📺 جاري العمل على القناة: ${item.name}`);
            const streamUrl = await getStreamFromNetwork(item.page);

            if (streamUrl) {
                console.log(`   ✅ تم العثور على البث بنجاح.`);
                const localImg = await processImage(item.img, item.name);
                
                finalChannels.push({
                    name: item.name,
                    url: streamUrl,
                    logo: localImg,
                    source_page: item.page,
                    category: "Yalla TV",
                    timestamp: new Date().toLocaleString('ar-EG')
                });
            } else {
                console.log(`   ❌ القناة لا تعمل أو البث محمي بشكل متقدم.`);
            }
        }

    } catch (e) {
        console.log(`❌ خطأ عام أثناء التشغيل: ${e.message}`);
        await browser.close();
    }

    // حفظ النتائج النهائية في ملف JSON
    fs.writeFileSync(JSON_FILE, JSON.stringify(finalChannels, null, 2));
    console.log(`\n✨ اكتملت العملية! إجمالي القنوات الشغالة: ${finalChannels.length}`);
}

startScraping();
