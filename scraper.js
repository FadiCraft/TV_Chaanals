const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');

puppeteer.use(StealthPlugin());

const BASE_URL = 'https://www.qanwatlive.com/';
const IMG_DIR = './image';

if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

// دالة لفحص الرابط هل يعمل أم لا (Status 200)
async function isLinkWorking(url) {
    try {
        const response = await axios.head(url, { timeout: 5000 });
        return response.status === 200;
    } catch (error) {
        return false;
    }
}

async function scrape() {
    console.log('🚀 بدء الفحص المتقدم لاستخراج الروابط المباشرة...');
    
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        console.log('🌐 جاري جلب قائمة القنوات...');
        await page.goto(BASE_URL, { waitUntil: 'networkidle2' });

        const channels = await page.evaluate(() => {
            const cards = document.querySelectorAll('.swiper-slide.card');
            return Array.from(cards).map(card => ({
                name: card.querySelector('.name a')?.innerText.trim(),
                pageUrl: card.querySelector('a.post-link')?.href,
                imgUrl: card.querySelector('img.card-img')?.src
            })).filter(c => c.pageUrl);
        });

        const finalResults = [];

        for (let i = 0; i < channels.length; i++) {
            const ch = channels[i];
            const chPage = await browser.newPage();
            let directStreamUrl = null;

            // تفعيل مراقبة الشبكة لالتقاط الروابط المباشرة
            await chPage.setRequestInterception(true);
            chPage.on('request', request => {
                const url = request.url();
                if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('get_stream')) {
                    directStreamUrl = url;
                }
                request.continue();
            });

            try {
                console.log(`🔍 فحص القناة (${i + 1}/${channels.length}): ${ch.name}`);
                await chPage.goto(ch.pageUrl, { waitUntil: 'networkidle2', timeout: 45000 });

                // إذا لم يتم التقاط رابط m3u8 تلقائياً، نبحث في الـ Iframes
                if (!directStreamUrl) {
                    directStreamUrl = await chPage.evaluate(() => {
                        const frame = document.querySelector('iframe');
                        return frame ? frame.src : null;
                    });
                }

                if (directStreamUrl) {
                    // فحص الرابط المستخرج هل يعمل؟
                    const status = await isLinkWorking(directStreamUrl);
                    
                    if (status) {
                        const imageName = `ch_${Date.now()}.jpg`;
                        const imagePath = path.join(IMG_DIR, imageName);

                        // تحميل الصورة ومعالجتها
                        try {
                            const imgRes = await axios.get(ch.imgUrl, { responseType: 'arraybuffer' });
                            await sharp(imgRes.data).resize(400, 225).toFile(imagePath);
                        } catch (e) {}

                        finalResults.push({
                            id: i + 1,
                            name: ch.name,
                            logo: `image/${imageName}`,
                            stream_url: directStreamUrl,
                            status: "Online",
                            last_check: new Date().toISOString()
                        });
                        console.log(`✅ تعمل: ${ch.name}`);
                    } else {
                        console.log(`❌ رابط معطل للقناة: ${ch.name}`);
                    }
                }
            } catch (err) {
                console.log(`⚠️ خطأ أثناء معالجة ${ch.name}`);
            } finally {
                await chPage.close();
            }
        }

        fs.writeFileSync('channels.json', JSON.stringify(finalResults, null, 4));
        console.log(`\n🎉 اكتمل العمل! القنوات الشغالة: ${finalResults.length}`);

    } finally {
        await browser.close();
    }
}

scrape();
