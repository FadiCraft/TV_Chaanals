const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');

// استخدام إضافة التخفي لتجاوز Cloudflare
puppeteer.use(StealthPlugin());

const IMAGE_DIR = './image';
const JSON_FILE = 'channels_yalla.json';
const BASE_URL = 'https://www.yallatv.online';

if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

/**
 * استخراج رابط m3u8 من خلال مراقبة حركة الشبكة
 */
async function getStreamFromNetwork(pageUrl) {
    const browser = await puppeteer.launch({ 
        headless: true, // يجب أن يكون true في GitHub Actions
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const page = await browser.newPage();
    let streamUrl = null;

    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // تفعيل اعتراض الطلبات
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            // البحث عن روابط m3u8 التي تحتوي على "chunklist" أو "index" أو تنتهي بـ m3u8
            if (url.includes('.m3u8') || url.includes('akamaized.net')) {
                console.log(`   🎯 تم العثور على رابط في الشبكة: ${url.substring(0, 70)}...`);
                streamUrl = url;
            }
            request.continue();
        });

        console.log(`   🌐 جاري فتح: ${pageUrl}`);
        // ننتظر حتى استقرار الشبكة لضمان تحميل المشغل
        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 45000 });
        
        // مهلة إضافية للتأكد من التقاط الرابط
        await new Promise(r => setTimeout(r, 6000));

    } catch (e) {
        console.log(`   ❌ خطأ في الصفحة: ${e.message}`);
    } finally {
        await browser.close();
    }
    return streamUrl;
}

/**
 * تحميل ومعالجة صورة القناة
 */
async function processImage(imgUrl, channelName) {
    if (!imgUrl) return "";
    try {
        const safeName = channelName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_').toLowerCase();
        const fileName = `${safeName}.webp`;
        const filePath = path.join(IMAGE_DIR, fileName);

        const response = await axios({ url: imgUrl, responseType: 'arraybuffer', timeout: 5000 });
        await sharp(response.data).resize(400, 225).toFile(filePath);
        return `https://raw.githubusercontent.com/FadiCraft/TV_Chaanals/main/image/${fileName}`;
    } catch { return ""; }
}

async function startScraping() {
    const finalChannels = [];
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();

    try {
        console.log(`\n🚀 جاري فحص الصفحة الرئيسية: ${BASE_URL}/amp/`);
        await page.goto(`${BASE_URL}/amp/`, { waitUntil: 'networkidle2' });
        const content = await page.content();
        const $ = cheerio.load(content);
        
        const items = [];
        $('.channels-grid a.channel').each((i, el) => {
            const name = $(el).find('.channel-name').text().trim();
            const href = $(el).attr('href');
            let img = $(el).find('amp-img img').attr('src') || $(el).find('amp-img').attr('src');

            if (href) {
                items.push({
                    name,
                    page: href.startsWith('http') ? href : BASE_URL + href,
                    img: img ? (img.startsWith('http') ? img : BASE_URL + img) : ""
                });
            }
        });

        console.log(`✅ تم استخراج ${items.length} قناة. بدأ فحص السيرفرات المباشرة...`);
        await browser.close();

        for (const item of items) {
            console.log(`\n📺 جاري فحص: ${item.name}`);
            const directUrl = await getStreamFromNetwork(item.page);

            if (directUrl) {
                console.log(`   ✅ تم الحصول على الرابط المباشر.`);
                const localImg = await processImage(item.img, item.name);
                
                finalChannels.push({
                    name: item.name,
                    url: directUrl,
                    local_img: localImg,
                    source: item.page,
                    last_update: new Date().toLocaleString('ar-EG')
                });
            } else {
                console.log(`   ❌ لم يتم العثور على بث يعمل لهذه القناة.`);
            }
        }

    } catch (e) {
        console.log(`❌ خطأ عام: ${e.message}`);
    }

    fs.writeFileSync(JSON_FILE, JSON.stringify(finalChannels, null, 2));
    console.log(`\n✨ تم الانتهاء! تم حفظ ${finalChannels.length} قناة في ${JSON_FILE}`);
}

startScraping();
