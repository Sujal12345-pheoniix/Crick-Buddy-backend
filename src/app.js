const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');


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

// Build CORS origin list from environment variable + hardcoded known-safe domains
const _envOrigins = (process.env.FRONTEND_URL || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const allowedOrigins = [...new Set([
    "https://crickbuddy.tech",
    "https://www.crickbuddy.tech",
    "https://crick-buddy-frontend.vercel.app",
    ..._envOrigins,
])];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl, Render internal)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`CORS blocked: ${origin}`);
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));


app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));


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