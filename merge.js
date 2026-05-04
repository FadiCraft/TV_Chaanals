const fs = require('fs');

// أسماء الملفات الثلاثة - قم بتعديلها لتطابق أسماء ملفاتك
const files = ['channels1.json', 'channels2.json', 'channels3.json'];
const outputFile = 'All_channels.json';

let allChannels = [];

files.forEach(file => {
    if (fs.existsSync(file)) {
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (Array.isArray(data)) {
                allChannels = allChannels.concat(data);
            }
        } catch (error) {
            console.error(`Error reading ${file}:`, error);
        }
    }
});

// إضافة الـ ID لكل قناة وإعادة ترتيب الخصائص ليظهر الـ ID أولاً
const indexedChannels = allChannels.map((channel, index) => ({
    id: index + 1,
    ...channel
}));

// حفظ الملف النهائي بتنسيق JSON مرتب
try {
    fs.writeFileSync(outputFile, JSON.stringify(indexedChannels, null, 4), 'utf8');
    console.log(`تم بنجاح! تم دمج ${indexedChannels.length} قناة في ملف ${outputFile}`);
} catch (error) {
    console.error('Error writing output file:', error);
}
