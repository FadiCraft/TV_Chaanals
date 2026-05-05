const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');

puppeteer.use(StealthPlugin());

const IMAGE_DIR = './image';
const JSON_FILE = 'channels_yalla.json';
const BASE_URL = 'https://www.yallatv.online';

if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

async function getStreamFromNetwork(pageUrl, channelName) {
    const browser = await puppeteer.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'] 
    });
    
    const page = await browser.newPage();
    let streamUrl = null;

    try {
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');

        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            if (url.includes('.m3u8') || url.includes('akamaized.net')) {
                console.log(`   🎯 لقطة شبكة: ${url.substring(0, 50)}...`);
                streamUrl = url;
            }
            request.continue();
        });

        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 12000)); 

    } catch (e) {
        console.log(`   ⚠️ خطأ أثناء فحص الشبكة لـ ${channelName}: ${e.message}`);
    } finally {
        await browser.close();
    }
    return streamUrl;
}

async function startScraping() {
    console.log("🚀 بدء استخراج القنوات...");
    const finalChannels = [];
    const browser = await puppeteer.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();

    try {
        // محاكاة متصفح موبايل لأن الصفحة AMP
        await page.setViewport({ width: 390, height: 844, isMobile: true });
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');
        
        console.log(`🔎 الدخول إلى: ${BASE_URL}/amp/`);
        await page.goto(`${BASE_URL}/amp/`, { waitUntil: 'networkidle2', timeout: 60000 });

        // محاولة الانتظار، وإذا فشل نأخذ لقطة شاشة ونكمل جلب الـ HTML المتوفر
        try {
            await page.waitForSelector('.channels-grid', { timeout: 15000 });
        } catch (err) {
            console.log("⚠️ لم يظهر Selector القنوات، سأحاول تحليل الصفحة كما هي...");
            await page.screenshot({ path: 'debug-main-page.png' });
        }

        const content = await page.content();
        const $ = cheerio.load(content);
        
        const items = [];
        $('.channels-grid a.channel, .channel').each((i, el) => {
            const name = $(el).find('.channel-name').text().trim();
            const href = $(el).attr('href');
            if (href && name) {
                items.push({
                    name,
                    page: href.startsWith('http') ? href : BASE_URL + href
                });
            }
        });

        console.log(`✅ تم رصد ${items.length} قناة.`);
        await browser.close();

        // فحص القنوات (محدد بـ 15 قناة فقط لتجنب طول وقت الـ Action)
        for (const item of items.slice(0, 20)) {
            console.log(`\n📺 فحص: ${item.name}`);
            const streamUrl = await getStreamFromNetwork(item.page, item.name);

            if (streamUrl) {
                finalChannels.push({
                    name: item.name,
                    url: streamUrl,
                    source: item.page,
                    date: new Date().toLocaleString('ar-EG')
                });
                console.log(`   ✅ تم الاستخراج.`);
            } else {
                console.log(`   ❌ لا يوجد رابط.`);
            }
        }

    } catch (e) {
        console.log(`❌ خطأ مدمر: ${e.message}`);
        await page.screenshot({ path: 'debug-fatal-error.png' });
        await browser.close();
    }

    fs.writeFileSync(JSON_FILE, JSON.stringify(finalChannels, null, 2));
    console.log(`\n✨ المهام انتهت. القنوات المكتشفة: ${finalChannels.length}`);
}

startScraping();
