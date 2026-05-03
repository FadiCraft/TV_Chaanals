const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');

puppeteer.use(StealthPlugin());

const BASE_URL = 'https://www.qanwatlive.com/';
// يمكنك تغيير START_URL للرابط الرئيسي أو رابط قسم معين
const START_URL = 'https://www.qanwatlive.com/'; 
const IMG_DIR = './image';

if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

async function scrape() {
    console.log('🚀 بدء الفحص لموقع QanwatLive...');
    
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        console.log('🌐 جاري فتح الموقع...');
        await page.goto(START_URL, { waitUntil: 'networkidle2', timeout: 60000 });

        // استخراج القنوات بناءً على الهيكل الجديد (swiper-slide)
        const channels = await page.evaluate(() => {
            // نستهدف الكروت داخل قسم قنوات MBC أو أي قسم مشابه
            const cards = document.querySelectorAll('.swiper-slide.card');
            return Array.from(cards).map(card => {
                const linkEl = card.querySelector('a.post-link');
                const imgEl = card.querySelector('img.card-img');
                return {
                    name: card.querySelector('.name a')?.innerText.trim() || imgEl?.alt,
                    pageUrl: linkEl?.href,
                    imgUrl: imgEl?.src
                };
            }).filter(c => c.pageUrl); // التأكد من وجود رابط
        });

        console.log(`[+] تم العثور على ${channels.length} قناة. جاري استخراج السيرفرات المباشرة...`);

        const finalResults = [];

        for (let i = 0; i < channels.length; i++) {
            const ch = channels[i];
            
            try {
                await page.goto(ch.pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                
                // في مواقع بلوجر غالباً يكون السيرفر داخل iframe أو وسام video
                // سنبحث عن أول iframe يحتوي على مشغل فيديو
                const streamData = await page.evaluate(() => {
                    // نبحث عن iframe البث، غالباً يكون بكلاس معين أو داخل container الفيديو
                    const iframe = document.querySelector('.post-body iframe') || document.querySelector('iframe[src*="m3u8"]') || document.querySelector('iframe');
                    return iframe ? iframe.src : null;
                });

                if (streamData) {
                    const imageName = `ch_${Date.now()}_${i}.jpg`;
                    const imagePath = path.join(IMG_DIR, imageName);

                    // تحميل ومعالجة الشعار
                    try {
                        const imgRes = await axios.get(ch.imgUrl, { responseType: 'arraybuffer' });
                        await sharp(imgRes.data)
                            .resize(320, 180)
                            .jpeg({ quality: 85 })
                            .toFile(imagePath);
                    } catch (e) {
                        console.log(`⚠️ فشل تحميل صورة: ${ch.name}`);
                    }

                    finalResults.push({
                        id: i + 1,
                        name: ch.name,
                        image: `image/${imageName}`,
                        stream_url: streamData,
                        source_page: ch.pageUrl,
                        updated_at: new Date().toISOString()
                    });

                    console.log(`✅ تم بنجاح: ${ch.name}`);
                }

                // تأخير بسيط لتجنب الحظر
                await new Promise(r => setTimeout(r, 2000));

            } catch (err) {
                console.error(`❌ خطأ في صفحة القناة ${ch.name}: ${err.message}`);
            }
        }

        fs.writeFileSync('channels.json', JSON.stringify(finalResults, null, 4));
        console.log(`\n🎉 اكتمل التحديث! تم حفظ ${finalResults.length} قناة.`);

    } catch (error) {
        console.error('🔴 خطأ فادح:', error.message);
    } finally {
        await browser.close();
    }
}

scrape();
