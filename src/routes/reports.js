const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const prisma = require('../utils/prisma');

// GET /api/reports — All reports for current user
router.get('/', protect, async (req, res) => {
    try {
        const reportsData = await prisma.analysisReport.findMany({ 
            where: { userId: req.user.id },
            include: {
                upload: {
                    select: { id: true, type: true, filename: true, originalName: true, fileUrl: true, createdAt: true }
                },
                aggregateMetrics: true,
                faultLog: true
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        const reports = reportsData.map(formatReport);
        res.json({ success: true, reports });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/reports/by-upload/:uploadId — Report for specific upload
// IMPORTANT: This MUST be before /:id to avoid Express route shadowing
router.get('/by-upload/:uploadId', protect, async (req, res) => {
    try {
        const reportData = await prisma.analysisReport.findFirst({ 
            where: { uploadId: req.params.uploadId, userId: req.user.id },
            include: { 
                upload: true,
                rawFrameMetrics: {
                    orderBy: { frameIndex: 'asc' }
                },
                aggregateMetrics: true,
                faultLog: true
            }
        });
        if (!reportData) return res.status(404).json({ success: false, message: 'Report not found for this upload' });
        res.json({ success: true, report: formatReport(reportData) });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/reports/:id — Single report
router.get('/:id', protect, async (req, res) => {
    try {
        const reportData = await prisma.analysisReport.findFirst({ 
            where: { id: req.params.id, userId: req.user.id },
            include: {
                upload: {
                    select: { id: true, type: true, filename: true, originalName: true, fileUrl: true, createdAt: true, notes: true }
                },
                rawFrameMetrics: {
                    orderBy: { frameIndex: 'asc' }
                },
                aggregateMetrics: true,
                faultLog: true
            }
        });
        if (!reportData) return res.status(404).json({ success: false, message: 'Report not found' });
        res.json({ success: true, report: formatReport(reportData) });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Helper to transform flat DB record into nested objects for frontend components
 */
function formatReport(report) {
    if (!report) return null;
    return {
        ...report,
        battingMetrics: report.type === 'batting' ? {
            headStabilityScore: report.headStabilityScore,
            headStabilityVariance: report.headStabilityVariance,
            timingScore: report.timingScore,
            peakKneeFlexion: report.peakKneeFlexion,
            peakKneeExtension: report.peakKneeExtension,
            rangeOfMotion: report.rangeOfMotion,
            followThroughScore: report.followThroughScore,
            wristYDelta: report.wristYDelta,
            strideScore: report.strideScore,
            avgStrideRatio: report.avgStrideRatio,
            stanceScore: report.stanceScore,
            batSwingAngle: report.batSwingAngle,
            headPosition: report.headPosition,
            headPositionScore: report.headPositionScore,
            wristPositionScore: report.wristPositionScore,
            shotType: report.shotType,
            overallBattingScore: report.overallBattingScore
        } : null,
        bowlingMetrics: report.type === 'bowling' ? {
            armSmoothnessScore: report.armSmoothnessScore,
            avgJerk: report.avgJerk,
            releasePointScore: report.releasePointScore,
            peakWristY: report.peakWristY,
            releaseArmAngle: report.releaseArmAngle,
            wristPositionScore: report.wristPositionScore,
            wristPositionNote: report.wristPositionNote,
            armRotationAngle: report.armRotationAngle,
            armRotationScore: report.armRotationScore,
            releasePointNote: report.releasePointNote,
            estimatedBallSpeed: report.estimatedBallSpeed,
            speedClassification: report.speedClassification,
            balanceScore: report.balanceScoreBowling,
            bowlingStyle: report.bowlingStyle,
            overallBowlingScore: report.overallBowlingScore
        } : null,
        postureMetrics: report.type === 'posture' ? {
            shoulderAlignmentScore: report.shoulderAlignmentScore,
            shoulderAlignmentNote: report.shoulderAlignmentNote,
            kneeBendAngle: report.kneeBendAngle,
            kneeBendScore: report.kneeBendScore,
            balanceScore: report.balanceScorePosture,
            spinePosScore: report.spinePosScore,
            overallPostureScore: report.overallPostureScore
        } : null,
        balanceScore: report.balanceScore,
        avgHipTilt: report.avgHipTilt,
        avgSpineOffset: report.avgSpineOffset
    };
}

module.exports = router;
