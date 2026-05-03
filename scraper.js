const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');

// تفعيل إضافة التخفي لتجاوز حماية Cloudflare
puppeteer.use(StealthPlugin());

const BASE_URL = 'https://www.yallatv.online';
const START_URL = 'https://www.yallatv.online/amp/';
const IMG_DIR = './image';

// إنشاء مجلد الصور إذا لم يكن موجوداً
if (!fs.existsSync(IMG_DIR)) {
    fs.mkdirSync(IMG_DIR, { recursive: true });
}

async function scrape() {
    console.log('🚀 بدء تشغيل المتصفح وتجاوز الحماية...');
    
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // 1. الدخول لصفحة AMP الرئيسية
        console.log('🌐 جاري الدخول إلى صفحة AMP...');
        await page.goto(START_URL, { waitUntil: 'networkidle2', timeout: 60000 });

        // استخراج بيانات القنوات (الاسم، رابط الصفحة، رابط الصورة)
        const channels = await page.evaluate((base) => {
            const grid = document.querySelectorAll('.channels-grid a.channel');
            return Array.from(grid).map(link => ({
                name: link.querySelector('.channel-name')?.innerText.trim(),
                pageUrl: new URL(link.getAttribute('href'), base).href,
                rawImg: link.querySelector('amp-img')?.getAttribute('src') || link.querySelector('img')?.getAttribute('src')
            }));
        }, BASE_URL);

        console.log(`[+] تم العثور على ${channels.length} قناة. جاري استخراج السيرفرات...`);

        const finalResults = [];

        for (let i = 0; i < channels.length; i++) {
            const ch = channels[i];
            if (!ch.pageUrl || !ch.name) continue;

            try {
                // الانتقال لصفحة القناة الداخلية
                await page.goto(ch.pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                
                // استخراج رابط iframe البث
                const iframeSrc = await page.evaluate(() => {
                    const frame = document.querySelector('iframe.iframevideo');
                    return frame ? frame.getAttribute('src') : null;
                });

                if (iframeSrc) {
                    const directUrl = new URL(iframeSrc, BASE_URL).href;
                    const imageName = `${path.basename(ch.rawImg, path.extname(ch.rawImg))}.jpg`;
                    const imagePath = path.join(IMG_DIR, imageName);

                    // تحميل ومعالجة الصورة باستخدام Sharp
                    if (ch.rawImg) {
                        try {
                            const fullImgUrl = new URL(ch.rawImg, BASE_URL).href;
                            const imgRes = await axios.get(fullImgUrl, { responseType: 'arraybuffer' });
                            await sharp(imgRes.data)
                                .resize(320, 180)
                                .jpeg({ quality: 85 })
                                .toFile(imagePath);
                        } catch (imgErr) {
                            console.log(`⚠️ فشل تحميل صورة: ${ch.name}`);
                        }
                    }

                    finalResults.push({
                        id: i + 1,
                        name: ch.name,
                        image: `image/${imageName}`,
                        stream_url: directUrl,
                        updated_at: new Date().toISOString()
                    });

                    console.log(`✅ تم استخراج: ${ch.name}`);
                }

                // تأخير بسيط لتجنب كشف البوت
                await new Promise(r => setTimeout(r, 1500));

            } catch (err) {
                console.error(`❌ خطأ في ${ch.name}: ${err.message}`);
            }
        }

        // حفظ النتائج النهائية في ملف JSON
        fs.writeFileSync('channels.json', JSON.stringify(finalResults, null, 4));
        console.log(`\n🎉 اكتمل العمل! تم تحديث ${finalResults.length} قناة.`);

    } catch (error) {
        console.error('🔴 خطأ فادح أثناء التشغيل:', error.message);
    } finally {
        await browser.close();
    }
}

scrape();
