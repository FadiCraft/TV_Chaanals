const fs = require('fs');

// أسماء الملفات الثلاثة
const files = ['channels1.json', 'channels2.json', 'channels.json'];
const outputFile = 'All_channels.json';

let allChannels = [];
// مجموعة لتتبع الروابط المستخدمة لمنع التكرار
const seenUrls = new Set();

files.forEach(file => {
    if (fs.existsSync(file)) {
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (Array.isArray(data)) {
                data.forEach(channel => {
                    // --- شروط التحقق قبل الإضافة ---
                    // 1. التأكد من وجود اسم للقناة
                    // 2. التأكد من وجود رابط الصورة الأصلية (original_img) وأنها ليست فارغة
                    // 3. التأكد من وجود رابط السيرفر (server_url)
                    // 4. التأكد من أن رابط السيرفر لم يسبق إضافته (منع تكرار الـ URL)
                    
                    const hasName = channel.name && channel.name.trim() !== "";
                    const hasImg = channel.original_img && channel.original_img.trim() !== "";
                    const hasUrl = channel.server_url && channel.server_url.trim() !== "";
                    const isNotDuplicateUrl = !seenUrls.has(channel.server_url);

                    if (hasName && hasImg && hasUrl && isNotDuplicateUrl) {
                        allChannels.push(channel);
                        seenUrls.add(channel.server_url); // تسجيل الرابط لمنع تكراره لاحقاً
                    }
                });
            }
        } catch (error) {
            console.error(`Error reading ${file}:`, error);
        }
    }
});

// إضافة الـ ID لكل قناة بعد التصفية وإعادة ترتيب الخصائص
const indexedChannels = allChannels.map((channel, index) => ({
    id: index + 1,
    ...channel
}));

// حفظ الملف النهائي بتنسيق JSON مرتب
try {
    fs.writeFileSync(outputFile, JSON.stringify(indexedChannels, null, 4), 'utf8');
    console.log(`✅ تم بنجاح!`);
    console.log(`📺 عدد القنوات الصالحة والفريدة: ${indexedChannels.length}`);
    console.log(`📁 تم حفظ النتيجة في: ${outputFile}`);
} catch (error) {
    console.error('Error writing output file:', error);
}
