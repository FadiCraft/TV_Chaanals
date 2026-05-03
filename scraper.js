const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');

// تفعيل إضافة التخفي لتجاوز حماية المواقع
puppeteer.use(StealthPlugin());

const BASE_URL = 'https://www.qanwatlive.com/';
const IMG_DIR = './image';

// التأكد من وجود مجلد الصور
if (!fs.existsSync(IMG_DIR)) {
    fs.mkdirSync(IMG_DIR, { recursive: true });
}

async function scrape() {
    console.log('🚀 بدء عملية الفحص لموقع QanwatLive...');
    
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--window-size=1920,1080'
        ]
    });

    try {
        const page = await browser.newPage();
        
        // إعداد هوية المتصفح
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        console.log(`🌐 جاري الدخول إلى: ${BASE_URL}`);
        await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 60000 });

        // --- خطوة التمرير التلقائي لضمان ظهور كل القنوات ---
        console.log('📜 جاري تمرير الصفحة لتحميل كافة القنوات...');
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                let distance = 200;
                let timer = setInterval(() => {
                    let scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= scrollHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });

        // --- استخراج بيانات القنوات من الهيكل الجديد ---
        const channels = await page.evaluate(() => {
            const cards = document.querySelectorAll('.swiper-slide.card');
            const data = [];
            
            cards.forEach(card => {
                const linkEl = card.querySelector('a.post-link');
                const imgEl = card.querySelector('img.card-img');
                const nameEl = card.querySelector('.name a') || card.querySelector('.name');

                if (linkEl && linkEl.href) {
                    data.push({
                        name: nameEl ? nameEl.innerText.trim() : 'Unknown Channel',
                        pageUrl: linkEl.href,
                        imgUrl: imgEl ? imgEl.src : null
                    });
                }
            });
            return data;
        });

        console.log(`[+] تم العثور على ${channels.length} قناة. جاري استخراج روابط البث...`);

        const finalResults = [];

        for (let i = 0; i < channels.length; i++) {
            const ch = channels[i];
            console.log(`🔄 جاري فحص (${i + 1}/${channels.length}): ${ch.name}`);

            try {
                const chPage = await browser.newPage();
                await chPage.goto(ch.pageUrl, { waitUntil: 'domcontentloaded', timeout: 40000 });

                // البحث عن رابط البث داخل الـ iframe
                const streamUrl = await chPage.evaluate(() => {
                    // نبحث عن iframe البث المباشر داخل محتوى المقال
                    const selectors = [
                        '.post-body iframe',
                        'iframe[src*="youtube"]',
                        'iframe[src*="m3u8"]',
                        '.video-container iframe',
                        '#PlayerHolder iframe'
                    ];
                    
                    for (let selector of selectors) {
                        const frame = document.querySelector(selector);
                        if (frame && frame.src) return frame.src;
                    }
                    
                    // محاولة أخيرة للبحث عن أي iframe إذا لم نجد في المحددات أعلاه
                    const anyFrame = document.querySelector('iframe');
                    return anyFrame ? anyFrame.src : null;
                });

                if (streamUrl) {
                    // معالجة وحفظ الصورة
                    let localImagePath = 'image/default.jpg';
                    if (ch.imgUrl) {
                        const imageName = `ch_${Date.now()}_${i}.jpg`;
                        const savePath = path.join(IMG_DIR, imageName);
                        
                        try {
                            const response = await axios.get(ch.imgUrl, { responseType: 'arraybuffer' });
                            await sharp(response.data)
                                .resize(400, 225) // مقاس 16:9 مناسب لـ Android TV
                                .jpeg({ quality: 80 })
                                .toFile(savePath);
                            localImagePath = `image/${imageName}`;
                        } catch (imgErr) {
                            console.log(`⚠️ فشل معالجة الصورة لـ ${ch.name}`);
                        }
                    }

                    finalResults.push({
                        id: i + 1,
                        name: ch.name,
                        logo: localImagePath,
                        stream_url: streamUrl,
                        category: "General",
                        updated_at: new Date().toLocaleString('ar-EG')
                    });

                    console.log(`✅ تم استخراج: ${ch.name}`);
                }

                await chPage.close();
                // تأخير بسيط لتجنب كشف البوت
                await new Promise(r => setTimeout(r, 1500));

            } catch (err) {
                console.error(`❌ خطأ في القناة ${ch.name}: ${err.message}`);
            }
        }

        // حفظ النتائج في ملف JSON
        fs.writeFileSync('channels.json', JSON.stringify(finalResults, null, 4));
        console.log(`\n✨ تم الانتهاء! إجمالي القنوات المستخرجة: ${finalResults.length}`);
        console.log(`📁 البيانات محفوظة في: channels.json`);

    } catch (error) {
        console.error('🔴 خطأ فادح أثناء التشغيل:', error.message);
    } finally {
        await browser.close();
    }
}

// تنفيذ السكريبت
scrape();
