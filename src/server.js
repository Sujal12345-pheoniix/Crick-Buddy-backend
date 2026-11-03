require('dotenv').config();
// Printed before anything else loads, so a deploy log shows whether Node started at all.
console.log(`ℹ️  Starting Crick-Buddy backend (node ${process.version}, PORT=${process.env.PORT || 'unset'})`);

const app = require('./app');
const { startRecoverySweep } = require('./utils/queue');
const { aiServiceUrl, wakeAiService, startAiKeepAlive } = require('./utils/aiService');
const prisma = require('./utils/prisma');

const PORT = process.env.PORT || 5000;

// ✅ START SERVER
// Bind on all interfaces so Render's port scan can see the service.
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Crick-Buddy Backend running on PORT ${PORT} (${process.env.NODE_ENV || 'development'})`);
    console.log(`✅ AI Service URL: ${aiServiceUrl()}`);
    prisma.$queryRaw`SELECT 1`
        .then(() => console.log('✅ Database connected'))
        .catch((err) => console.error(`❌ Database not responding — uploads cannot be analysed until it is fixed: ${err.message}`));
    startRecoverySweep();
    // The backend usually boots because a user just opened the app — wake the AI service too.
    wakeAiService();
    startAiKeepAlive();
});