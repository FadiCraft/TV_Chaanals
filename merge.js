const fs = require('fs');

const files = ['channels1.json', 'channels2.json', 'channels.json'];
const outputFile = 'All_channels.json';

const mergedChannels = {};
// مجموعة لتتبع الروابط المستخدمة لمنع تكرار نفس الرابط لقنوات مختلفة
const seenUrls = new Set();

files.forEach((fileName, index) => {
    if (fs.existsSync(fileName)) {
        try {
            const content = fs.readFileSync(fileName, 'utf8');
            let data = JSON.parse(content);

            if (Array.isArray(data)) {
                data.forEach(ch => {
                    // --- شرط التحقق الجديد ---
                    // التأكد من وجود الاسم، وجود رابط الصورة الأصلية، ووجود رابط السيرفر
                    if (ch.name && ch.original_img && ch.original_img.trim() !== "" && ch.server_url) {
                        
                        // التأكد من أن الرابط (url) لم يسبق استخدامه مع قناة أخرى
                        if (!seenUrls.has(ch.server_url)) {
                            
                            if (!mergedChannels[ch.name]) {
                                // إنشاء سجل القناة إذا كانت تظهر لأول مرة
                                mergedChannels[ch.name] = {
                                    ...ch,
                                    steem1: "",
                                    steem2: "",
                                    steem3: ""
                                };
                                delete mergedChannels[ch.name].server_url;
                            }

                            // إضافة الرابط في الخانة المناسبة بناءً على ترتيب الملف
                            const serverKey = `steem${index + 1}`;
                            mergedChannels[ch.name][serverKey] = ch.server_url;
                            
                            // تسجيل الرابط كـ "مستخدم" حتى لا يتكرر
                            seenUrls.add(ch.server_url);
                        }
                    }
                });
            }
        } catch (error) {
            console.error(`خطأ في قراءة الملف ${fileName}:`, error);
        }
    }
});

// تحويل الكائن إلى مصفوفة وإعادة ترتيب السيرفرات (steem1, steem2, steem3)
const finalResult = Object.values(mergedChannels).map((ch, idx) => {
    // تجميع الروابط الموجودة فقط وحذف الفراغات
    let servers = [ch.steem1, ch.steem2, ch.steem3].filter(s => s && s.trim() !== "");
    
    return {
        id: idx + 1,
        name: ch.name,
        category: ch.category,
        local_img: ch.local_img,
        original_img: ch.original_img, // سيبقى متاحاً في الملف النهائي
        status: ch.status,
        last_update: ch.last_update,
        steem1: servers[0] || "",
        steem2: servers[1] || "",
        steem3: servers[2] || ""
    };
});

// حفظ الملف النهائي
try {
    fs.writeFileSync(outputFile, JSON.stringify(finalResult, null, 4), 'utf8');
    console.log(`✅ تم الدمج بنجاح!`);
    console.log(`📺 عدد القنوات الفريدة: ${finalResult.length}`);
    console.log(`🔗 تم استبعاد الروابط المكررة والصور الناقصة.`);
} catch (error) {
    console.error('❌ خطأ أثناء حفظ الملف:', error);
}
