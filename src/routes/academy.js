const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const prisma = require('../utils/prisma');

// GET /api/academy/players — Coach sees all players
router.get('/players', protect, authorize('coach', 'admin'), async (req, res) => {
    try {
        const players = await prisma.user.findMany({
            where: { role: 'player' },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true, name: true, email: true, avatar: true, phone: true,
                battingStyle: true, bowlingStyle: true, playerType: true,
                experienceLevel: true, overallScore: true, isActive: true,
                createdAt: true, totalReports: true, totalUploads: true
            }
        });

        // Attach latest report to each player
        const playersWithData = await Promise.all(players.map(async (player) => {
            const latestReport = await prisma.analysisReport.findFirst({
                where: { userId: player.id },
                orderBy: { createdAt: 'desc' },
                select: { overallScore: true, type: true, createdAt: true }
            });
            const totalReportsCount = await prisma.analysisReport.count({
                where: { userId: player.id }
            });
            return {
                ...player,
                latestReport,
                totalReports: totalReportsCount
            };
        }));

        res.json({ success: true, players: playersWithData });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/academy/players/:id — Get specific player details
router.get('/players/:id', protect, authorize('coach', 'admin'), async (req, res) => {
    try {
        const player = await prisma.user.findUnique({
            where: { id: req.params.id },
            select: {
                id: true, name: true, email: true, avatar: true, phone: true,
                battingStyle: true, bowlingStyle: true, playerType: true,
                experienceLevel: true, overallScore: true, isActive: true,
                createdAt: true
            }
        });
        if (!player) return res.status(404).json({ success: false, message: 'Player not found' });

        const reports = await prisma.analysisReport.findMany({
            where: { userId: player.id },
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: { upload: { select: { type: true, fileUrl: true } } }
        });
        const progress = await prisma.progressEntry.findMany({
            where: { userId: player.id },
            orderBy: { date: 'desc' },
            take: 30
        });

        res.json({ success: true, player, reports, progress });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/academy/leaderboard
router.get('/leaderboard', protect, async (req, res) => {
    try {
        const players = await prisma.user.findMany({
            where: { role: 'player' },
            select: { id: true, name: true, avatar: true, playerType: true, experienceLevel: true, overallScore: true, totalReports: true },
            orderBy: { overallScore: 'desc' },
            take: 20
        });

        res.json({ success: true, leaderboard: players });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
