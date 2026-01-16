try {
    console.log('1. Requiring config/s3...');
    require('./src/config/s3');
    console.log('✅ config/s3 loaded');

    console.log('2. Requiring utils/s3...');
    require('./src/utils/s3');
    console.log('✅ utils/s3 loaded');

    console.log('3. Requiring socket/index...');
    const socketInit = require('./src/socket/index');
    console.log('✅ socket/index loaded');

} catch (e) {
    console.error('❌ ERROR:', e);
}
