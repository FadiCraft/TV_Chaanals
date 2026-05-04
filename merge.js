const fs = require('fs');

// أسماء الملفات الثلاثة
const files = ['channels1.json', 'channels2.json', 'channels.json'];
const outputFile = 'All_channels.json';

let rawChannels = [];

// 1. قراءة البيانات من الملفات
files.forEach(file => {
    if (fs.existsSync(file)) {
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (Array.isArray(data)) {
                rawChannels = rawChannels.concat(data);
            }
        } catch (error) {
            console.error(`Error reading ${file}:`, error);
        }
    }
});

// 2. دمج القنوات المكررة وتوزيع السيرفرات
const mergedMap = new Map();

rawChannels.forEach(channel => {
    const name = channel.name;
    const url = channel.server_url;

    if (mergedMap.has(name)) {
        let existing = mergedMap.get(name);
        // إضافة السيرفرات الإضافية إذا وجدت تكرار
        if (!existing.steem2 && url !== existing.steem1) {
            existing.steem2 = url;
        } else if (!existing.steem3 && url !== existing.steem1 && url !== existing.steem2) {
            existing.steem3 = url;
        }
    } else {
        // إنشاء كائن القناة لأول مرة
        mergedMap.set(name, {
            ...channel,
            steem1: url,
            steem2: "",
            steem3: ""
        });
    }
});

// 3. تحويل الـ Map إلى مصفوفة وإضافة الـ ID
const finalChannels = Array.from(mergedMap.values()).map((channel, index) => ({
    id: index + 1,
    name: channel.name,
    category: channel.category,
    server_url: channel.server_url,
    local_img: channel.local_img,
    status: channel.status,
    last_update: channel.last_update,
    steem1: channel.steem1,
    steem2: channel.steem2,
    steem3: channel.steem3
}));

// 4. حفظ الملف النهائي
try {
    fs.writeFileSync(outputFile, JSON.stringify(finalChannels, null, 4), 'utf8');
    console.log(`تم بنجاح! تم دمج القنوات. العدد النهائي الفريد: ${finalChannels.length}`);
} catch (error) {
    console.error('Error writing output file:', error);
}
