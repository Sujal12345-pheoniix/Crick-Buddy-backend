const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/uploads');
const reportRoutes = require('./routes/reports');
const progressRoutes = require('./routes/progress');
const equipmentRoutes = require('./routes/equipment');
const academyRoutes = require('./routes/academy');
const chatbotRoutes = require('./routes/chatbot');
const userRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');
const matchRoutes = require('./routes/matches');
const tournamentRoutes = require('./routes/tournaments');

const app = express();

// ✅ Security & middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

app.use(cors({
    origin: [
        "https://crick-buddy-frontend.vercel.app", // ✅ your deployed frontend
        "http://localhost:3000" // ✅ local dev
    ],
    credentials: true
}));

app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Static files (uploads)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// =========================
// ✅ ROOT ROUTE (IMPORTANT)
// =========================
app.get('/', (req, res) => {
    res.send("CrickBuddy Backend Running 🚀");
});

// =========================
// ✅ HEALTH CHECK
// =========================
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'crick-buddy-backend',
        timestamp: new Date().toISOString()
    });
});

// =========================
// ✅ API ROUTES
// =========================
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api/academy', academyRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/tournaments', tournamentRoutes);

// =========================
// ❌ 404 HANDLER (KEEP LAST)
// =========================
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// =========================
// ❌ ERROR HANDLER
// =========================
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal server error'
    });
});

module.exports = app;