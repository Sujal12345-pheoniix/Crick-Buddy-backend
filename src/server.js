require('dotenv').config();

const app = require('./app');
const { startRecoverySweep } = require('./utils/queue');
const { aiServiceUrl } = require('./utils/aiService');
const prisma = require('./utils/prisma');

const PORT = process.env.PORT || 5000;

// ✅ START SERVER
app.listen(PORT, () => {
    console.log(`✅ Crick-Buddy Backend running on PORT ${PORT} (${process.env.NODE_ENV || 'development'})`);
    console.log(`✅ AI Service URL: ${aiServiceUrl()}`);
    prisma.$queryRaw`SELECT 1`
        .then(() => console.log('✅ Database connected'))
        .catch((err) => console.error(`❌ Database not responding — uploads cannot be analysed until it is fixed: ${err.message}`));
    startRecoverySweep();
});