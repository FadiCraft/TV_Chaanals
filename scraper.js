const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function runScrapers() {
    try {
        console.log('🚀 بدء تشغيل الملفات الثلاثة...\n');
        
        // تشغيل الملف الأول
        console.log('📡 تشغيل arab-stream.js...');
        await execPromise('node arab-stream.js');
        console.log('✅ تم الانتهاء من arab-stream.js\n');
        
        // تشغيل الملف الثاني
        console.log('📡 تشغيل qanwat-live.js...');
        await execPromise('node qanwat-live.js');
        console.log('✅ تم الانتهاء من qanwat-live.js\n');
        
        // قراءة الملفين الناتجين
        console.log('📂 قراءة الملفات الناتجة...');
        
        let channels1 = [];
        let channels2 = [];
        
        if (fs.existsSync('channels1.json')) {
            const data1 = fs.readFileSync('channels1.json', 'utf8');
            channels1 = JSON.parse(data1);
            console.log(`📊 تم قراءة ${channels1.length} قناة من channels1.json`);
        } else {
            console.log('⚠️ الملف channels1.json غير موجود');
        }
        
        if (fs.existsSync('channels2.json')) {
            const data2 = fs.readFileSync('channels2.json', 'utf8');
            channels2 = JSON.parse(data2);
            console.log(`📊 تم قراءة ${channels2.length} قناة من channels2.json`);
        } else {
            console.log('⚠️ الملف channels2.json غير موجود');
        }
        
        // دمج المصفوفتين
        const mergedChannels = [...channels1, ...channels2];
        
        // إزالة التكرارات (اختياري - بناءً على الاسم والرابط)
        const uniqueChannels = mergedChannels.filter((channel, index, self) => 
            index === self.findIndex((c) => (
                c.name === channel.name && c.url === channel.url
            ))
        );
        
        console.log(`\n📊 إحصائيات الدمج:`);
        console.log(`- إجمالي القنوات قبل إزالة التكرار: ${mergedChannels.length}`);
        console.log(`- إجمالي القنوات بعد إزالة التكرار: ${uniqueChannels.length}`);
        console.log(`- تم إزالة ${mergedChannels.length - uniqueChannels.length} قناة مكررة`);
        
        // حفظ الملف المدمج
        fs.writeFileSync('channels.json', JSON.stringify(uniqueChannels, null, 2), 'utf8');
        console.log('✅ تم حفظ الملف المدمج channels.json بنجاح');
        
        // تحديث تاريخ آخر تحديث
        const now = new Date();
        const formattedDate = now.toLocaleDateString('ar-SA', {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric'
        });
        
        console.log(`🕐 وقت آخر تحديث: ${formattedDate}`);
        
    } catch (error) {
        console.error('❌ حدث خطأ:', error.message);
        process.exit(1);
    }
}

// تشغيل الدالة الرئيسية
runScrapers();
