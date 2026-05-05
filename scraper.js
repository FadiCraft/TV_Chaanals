const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

puppeteer.use(StealthPlugin());

const IMAGE_DIR = './image';
const JSON_FILE = 'channels_yalla.json';
const BASE_URL = 'https://www.yallatv.online';

if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

/**
 * وظيفة استخراج الرابط من خلال مراقبة الشبكة (Network Monitoring)
 */
async function getStreamFromNetwork(pageUrl) {
    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    let streamUrl = null;

    try {
        // ضبط User-Agent واقعي
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // تفعيل مراقبة الطلبات
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            if (url.includes('.m3u8')) {
                console.log(`   🎯 تم التقاط رابط من الشبكة: ${url.substring(0, 60)}...`);
                streamUrl = url;
            }
            request.continue();
        });

        console.log(`   🌐 جاري فتح الصفحة: ${pageUrl}`);
        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        // الانتظار قليلاً للتأكد من تحميل المشغل
        await new Promise(r => setTimeout(r, 5000));

    } catch (e) {
        console.log(`   ❌ خطأ أثناء تصفح الصفحة: ${e.message}`);
    } finally {
        await browser.close();
    }
    return streamUrl;
}

async function startScraping() {
    const finalChannels = [];
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();

    try {
        console.log(`\n🚀 جاري فحص الصفحة الرئيسية لتحديد القنوات...`);
        await page.goto(`${BASE_URL}/amp/`, { waitUntil: 'networkidle2' });
        const content = await page.content();
        const $ = cheerio.load(content);
        
        const items = [];
        $('.channels-grid a.channel').each((i, el) => {
            const name = $(el).find('.channel-name').text().trim();
            let href = $(el).attr('href');
            let img = $(el).find('amp-img').attr('src') || $(el).find('img').attr('src');

            items.push({
                name,
                page: href.startsWith('http') ? href : BASE_URL + href,
                img: img ? (img.startsWith('http') ? img : BASE_URL + img) : ""
            });
        });

        console.log(`✅ تم العثور على ${items.length} قناة. يبدأ الآن استخراج الروابط المباشرة...`);
        await browser.close(); // نغلق المتصفح الرئيسي لنفتح واحد لكل قناة لمراقبة الشبكة

        for (const item of items) {
            console.log(`\n📺 جاري العمل على: ${item.name}`);
            const directUrl = await getStreamFromNetwork(item.page);

            if (directUrl) {
                console.log(`   ✅ نجاح! تم استخراج الرابط.`);
                finalChannels.push({
                    name: item.name,
                    url: directUrl,
                    image: item.img,
                    source: item.page,
                    last_update: new Date().toLocaleString('ar-EG')
                });
            } else {
                console.log(`   ❌ فشل استخراج رابط m3u8 لهذه القناة.`);
            }
        }

    } catch (e) {
        console.log(`❌ خطأ عام: ${e.message}`);
    }

    fs.writeFileSync(JSON_FILE, JSON.stringify(finalChannels, null, 2));
    console.log(`\n✨ انتهى! تم حفظ ${finalChannels.length} قناة بنجاح.`);
}

startScraping();
