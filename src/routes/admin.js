const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const { protect, authorize } = require('../middleware/auth');

// All admin routes require auth + admin role
router.use(protect);
router.use(authorize('admin'));

// ─── Dashboard Stats ────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
    try {
        const [totalUsers, totalUploads, totalReports, players, coaches, recentUsers, recentUploads] = await Promise.all([
            prisma.user.count(),
            prisma.upload.count(),
            prisma.analysisReport.count(),
            prisma.user.count({ where: { role: 'player' } }),
            prisma.user.count({ where: { role: 'coach' } }),
            prisma.user.findMany({
                orderBy: { createdAt: 'desc' },
                take: 5,
                select: { id: true, name: true, email: true, role: true, createdAt: true, experienceLevel: true }
            }),
            prisma.upload.findMany({
                orderBy: { createdAt: 'desc' },
                take: 5,
                include: { user: { select: { name: true, email: true } } }
            }),
        ]);

        const completedUploads = await prisma.upload.count({ where: { status: 'completed' } });
        const processingRate = totalUploads > 0 ? ((completedUploads / totalUploads) * 100).toFixed(1) : 0;

        const [uploadsByTypeRaw, uploadsByStatusRaw] = await Promise.all([
            prisma.upload.groupBy({
                by: ['type'],
                _count: { id: true }
            }),
            prisma.upload.groupBy({
                by: ['status'],
                _count: { id: true }
            })
        ]);

        const uploadsByType = uploadsByTypeRaw.map(u => ({ _id: u.type, count: u._count.id }));
        const uploadsByStatus = uploadsByStatusRaw.map(u => ({ _id: u.status, count: u._count.id }));

        // Dynamic signups by month (Last 6 months)
        const signupsByMonth = [];
        for (let i = 5; i >= 0; i--) {
            const date = new Date();
            date.setMonth(date.getMonth() - i);
            const year = date.getFullYear();
            const month = date.getMonth() + 1;
            
            const start = new Date(year, month - 1, 1);
            const end = new Date(year, month, 0);
            
            const count = await prisma.user.count({
                where: { createdAt: { gte: start, lte: end } }
            });
            signupsByMonth.push({ _id: { year, month }, count });
        }

        res.json({
            success: true,
            stats: {
                totalUsers, totalUploads, totalReports, players, coaches, processingRate,
                recentUsers, recentUploads, uploadsByType, uploadsByStatus, signupsByMonth
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── Database Info ──────────────────────────────────────────────────────────
router.get('/db/collections', async (req, res) => {
    try {
        const tables = ['User', 'Upload', 'AnalysisReport', 'ProgressEntry', 'Academy', 'Match', 'Tournament'];
        const collections = await Promise.all(tables.map(async (table) => {
            const count = await prisma[table.charAt(0).toLowerCase() + table.slice(1)].count();
            return { name: table, count };
        }));

        res.json({ success: true, collections });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── User Management ────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
    try {
        const { page = 1, limit = 20, search = '', role = '' } = req.query;
        const skip = (Number(page) - 1) * Number(limit);
        
        const whereClause = {};
        if (search) {
            whereClause.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } }
            ];
        }
        if (role) whereClause.role = role;

        const total = await prisma.user.count({ where: whereClause });
        const users = await prisma.user.findMany({
            where: whereClause,
            orderBy: { createdAt: 'desc' },
            skip,
            take: Number(limit),
            select: {
                id: true, name: true, email: true, role: true, 
                experienceLevel: true, playerType: true, isActive: true, createdAt: true
            }
        });

        res.json({ success: true, users, total, pages: Math.ceil(total / Number(limit)), currentPage: Number(page) });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/users/:id', async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.params.id },
            select: {
                id: true, name: true, email: true, role: true, avatar: true,
                experienceLevel: true, playerType: true, isActive: true,
                createdAt: true, overallScore: true, battingStyle: true, bowlingStyle: true
            }
        });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        
        const [uploads, reports] = await Promise.all([
            prisma.upload.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
            prisma.analysisReport.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 10 })
        ]);
        res.json({ success: true, user, uploads, reports });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.put('/users/:id', async (req, res) => {
    try {
        const user = await prisma.user.update({
            where: { id: req.params.id },
            data: req.body,
            select: { id: true, name: true, email: true, role: true }
        });
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/users/:id', async (req, res) => {
    try {
        if (req.params.id === req.user.id) return res.status(400).json({ success: false, message: 'Cannot delete yourself' });
        
        await prisma.progressEntry.deleteMany({ where: { userId: req.params.id } });
        await prisma.analysisReport.deleteMany({ where: { userId: req.params.id } });
        await prisma.upload.deleteMany({ where: { userId: req.params.id } });
        await prisma.user.delete({ where: { id: req.params.id } });
        
        res.json({ success: true, message: 'User and all data deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
