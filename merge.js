const fs = require('fs');

// ترتيب الملفات مهم جداً هنا: الأول لـ steem1، الثاني لـ steem2، الثالث لـ steem3
const files = ['channels1.json', 'channels2.json', 'channels.json'];
const outputFile = 'All_channels.json';

// كائن لتخزين القنوات النهائية (المفتاح هو اسم القناة)
const mergedChannels = {};

files.forEach((fileName, index) => {
    if (fs.existsSync(fileName)) {
        try {
            const content = fs.readFileSync(fileName, 'utf8');
            let data = JSON.parse(content);

            if (Array.isArray(data)) {
                // 1. حذف التكرار داخل نفس الملف بناءً على الاسم (تأخذ أول ظهور فقط)
                const uniqueInFile = [];
                const seenInFile = new Set();
                
                data.forEach(ch => {
                    if (!seenInFile.has(ch.name)) {
                        uniqueInFile.push(ch);
                        seenInFile.add(ch.name);
                    }
                });

                // 2. توزيع الروابط على steem1, steem2, steem3 بناءً على ترتيب الملف
                uniqueInFile.forEach(ch => {
                    if (!mergedChannels[ch.name]) {
                        // إذا كانت القناة تظهر لأول مرة، ننشئ الكائن ونصفر السيرفرات
                        mergedChannels[ch.name] = {
                            ...ch,
                            steem1: "",
                            steem2: "",
                            steem3: ""
                        };
                        // حذف الحقل الأصلي server_url كما طلبت
                        delete mergedChannels[ch.name].server_url;
                    }

                    // وضع الرابط في الخانة المناسبة حسب ترتيب الملف (0, 1, 2)
                    const serverKey = `steem${index + 1}`;
                    mergedChannels[ch.name][serverKey] = ch.server_url;
                });
            }
        } catch (error) {
            console.error(`خطأ في قراءة الملف ${fileName}:`, error);
        }
    }
});

// 3. تحويل الكائن إلى مصفوفة وإضافة الـ ID مع التأكد من أولويات السيرفرات
const finalResult = Object.values(mergedChannels).map((ch, idx) => {
    
    // منطق الأولوية: إذا كانت القناة موجودة في ملف واحد فقط (مثلاً الملف الثالث) 
    // ولم تكن موجودة في الأول، ننقل الرابط ليكون في steem1
    let servers = [ch.steem1, ch.steem2, ch.steem3].filter(s => s !== "");
    
    return {
        id: idx + 1,
        name: ch.name,
        category: ch.category,
        local_img: ch.local_img,
        status: ch.status,
        last_update: ch.last_update,
        steem1: servers[0] || "",
        steem2: servers[1] || "",
        steem3: servers[2] || ""
    };
});

// 4. حفظ النتيجة
try {
    fs.writeFileSync(outputFile, JSON.stringify(finalResult, null, 4), 'utf8');
    console.log(`تم الدمج بنجاح! عدد القنوات الفريدة: ${finalResult.length}`);
} catch (error) {
    console.error('خطأ أثناء حفظ الملف:', error);
}
