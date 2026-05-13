require('dotenv').config();

const app = require('./app');

const PORT = process.env.PORT || 5000;

// ✅ START SERVER
app.listen(PORT, () => {
    console.log(`✅ Crick-Buddy Backend running on PORT ${PORT} (${process.env.NODE_ENV || 'development'})`);
    console.log(`✅ AI Service URL: ${process.env.AI_SERVICE_URL || 'http://localhost:8000'}`);
});