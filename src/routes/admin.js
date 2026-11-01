const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
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
            const end = new Date(year, month, 1);
            
            const count = await prisma.user.count({
                where: { createdAt: { gte: start, lt: end } }
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

const ADMIN_EDITABLE_FIELDS = ['name', 'email', 'role', 'experienceLevel', 'playerType', 'battingStyle', 'bowlingStyle', 'isActive'];
const VALID_ROLES = ['player', 'coach', 'admin'];

router.put('/users/:id', async (req, res) => {
    try {
        const updates = {};
        ADMIN_EDITABLE_FIELDS.forEach(field => {
            if (req.body[field] !== undefined) updates[field] = req.body[field];
        });

        if (updates.role !== undefined && !VALID_ROLES.includes(updates.role)) {
            return res.status(400).json({ success: false, message: 'Invalid role' });
        }
        if (updates.email !== undefined) {
            updates.email = String(updates.email).trim().toLowerCase();
            if (!updates.email) return res.status(400).json({ success: false, message: 'Email cannot be empty' });
        }
        if (updates.isActive !== undefined && typeof updates.isActive !== 'boolean') {
            return res.status(400).json({ success: false, message: 'isActive must be a boolean' });
        }
        if (req.params.id === req.user.id && updates.role !== undefined && updates.role !== 'admin') {
            return res.status(400).json({ success: false, message: 'Cannot remove your own admin role' });
        }

        const user = await prisma.user.update({
            where: { id: req.params.id },
            data: updates,
            select: { id: true, name: true, email: true, role: true }
        });
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Deletes reports matching `where` together with every row that references them.
function deleteReportsOps(where) {
    const byReport = { report: where };
    return [
        prisma.faultLog.deleteMany({ where: byReport }),
        prisma.aggregateMetric.deleteMany({ where: byReport }),
        prisma.rawFrameMetric.deleteMany({ where: byReport }),
        prisma.progressEntry.deleteMany({ where: byReport }),
        prisma.analysisReport.deleteMany({ where }),
    ];
}

function deleteUploadsOps(where) {
    return [
        ...deleteReportsOps({ upload: where }),
        prisma.rawFrameMetric.deleteMany({ where: { upload: where } }),
        prisma.upload.deleteMany({ where }),
    ];
}

// Best-effort removal of the stored media file (local disk or Cloudinary).
async function removeStoredFile(upload) {
    try {
        if (upload.fileUrl?.startsWith('/uploads/')) {
            const filePath = path.join(__dirname, '../../uploads', path.basename(upload.filename));
            await fs.promises.unlink(filePath).catch(() => {});
        } else if (upload.fileUrl?.includes('res.cloudinary.com')) {
            const match = upload.fileUrl.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-z0-9]+$/i);
            if (match) {
                const { deleteFile } = require('../config/cloudinary');
                await deleteFile(match[1], upload.fileUrl.includes('/video/') ? 'video' : 'image');
            }
        }
    } catch (err) {
        console.warn(`⚠️  Could not remove stored file for upload ${upload.id}: ${err.message}`);
    }
}

router.delete('/users/:id', async (req, res) => {
    try {
        if (req.params.id === req.user.id) return res.status(400).json({ success: false, message: 'Cannot delete yourself' });

        const userId = req.params.id;
        const uploads = await prisma.upload.findMany({ where: { userId } });
        await prisma.$transaction([
            ...deleteReportsOps({ userId }),
            ...deleteUploadsOps({ userId }),
            prisma.progressEntry.deleteMany({ where: { userId } }),
            prisma.matchPerformanceEntry.deleteMany({ where: { userId } }),
            prisma.user.delete({ where: { id: userId } }),
        ]);
        await Promise.all(uploads.map(removeStoredFile));

        res.json({ success: true, message: 'User and all data deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── Upload & Report Management ─────────────────────────────────────────────
function pageParams(query) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    return { limit, page, skip: (page - 1) * limit };
}

router.get('/uploads', async (req, res) => {
    try {
        const { limit, page, skip } = pageParams(req.query);
        const [total, uploads] = await Promise.all([
            prisma.upload.count(),
            prisma.upload.findMany({
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
                include: { user: { select: { name: true, email: true } } }
            })
        ]);
        res.json({ success: true, uploads, total, pages: Math.max(1, Math.ceil(total / limit)), currentPage: page });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/uploads/:id', async (req, res) => {
    try {
        const upload = await prisma.upload.findUnique({ where: { id: req.params.id } });
        if (!upload) return res.status(404).json({ success: false, message: 'Upload not found' });

        await prisma.$transaction([
            ...deleteUploadsOps({ id: upload.id }),
            prisma.user.update({ where: { id: upload.userId }, data: { totalUploads: { decrement: 1 } } }),
        ]);
        await removeStoredFile(upload);
        res.json({ success: true, message: 'Upload deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/reports', async (req, res) => {
    try {
        const { limit, page, skip } = pageParams(req.query);
        const [total, reports] = await Promise.all([
            prisma.analysisReport.count(),
            prisma.analysisReport.findMany({
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
                select: {
                    id: true, type: true, overallScore: true, createdAt: true, uploadId: true,
                    user: { select: { name: true, email: true } }
                }
            })
        ]);
        res.json({ success: true, reports, total, pages: Math.max(1, Math.ceil(total / limit)), currentPage: page });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/reports/:id', async (req, res) => {
    try {
        const report = await prisma.analysisReport.findUnique({ where: { id: req.params.id } });
        if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

        await prisma.$transaction([
            ...deleteReportsOps({ id: report.id }),
            prisma.user.update({ where: { id: report.userId }, data: { totalReports: { decrement: 1 } } }),
        ]);
        res.json({ success: true, message: 'Report deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
