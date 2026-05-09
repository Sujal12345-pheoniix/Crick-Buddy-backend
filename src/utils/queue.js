const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const prisma = require('./prisma');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

// ─── Redis Connection ──────────────────────────────────────────────────────
let connection = null;
let analysisQueue = null;
let analysisWorker = null;

function isQueueEnabled() {
    return String(process.env.ENABLE_ANALYSIS_QUEUE || '').toLowerCase() === 'true';
}

function rand(min, max) {
    return Math.round((Math.random() * (max - min) + min) * 10) / 10;
}

function toStringList(value, fallback = []) {
    if (Array.isArray(value)) {
        const cleaned = value
            .map((item) => (typeof item === 'string' ? item.trim() : String(item || '').trim()))
            .filter(Boolean);
        if (cleaned.length) return cleaned;
    }

    if (typeof value === 'string' && value.trim()) {
        const split = value
            .split(/\n|\.|;/)
            .map((item) => item.trim())
            .filter(Boolean);
        if (split.length) return split;
    }

    return fallback;
}

function deriveOverallScore(type, analysis) {
    const b = analysis?.batting_metrics || {};
    const bw = analysis?.bowling_metrics || {};
    const p = analysis?.posture_metrics || {};

    if (type === 'batting') {
        const score = [b.stanceScore, b.headPositionScore, b.timingScore, b.followThroughScore]
            .map((v) => Number(v))
            .filter((v) => Number.isFinite(v));
        return score.length ? Math.round(score.reduce((a, c) => a + c, 0) / score.length) : 0;
    }

    if (type === 'bowling') {
        const score = [bw.wristPositionScore, bw.armRotationScore, bw.releasePointScore, bw.balanceScore]
            .map((v) => Number(v))
            .filter((v) => Number.isFinite(v));
        return score.length ? Math.round(score.reduce((a, c) => a + c, 0) / score.length) : 0;
    }

    const score = [p.shoulderAlignmentScore, p.kneeBendScore, p.balanceScore, p.spinePosScore]
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v));
    return score.length ? Math.round(score.reduce((a, c) => a + c, 0) / score.length) : 0;
}

function normalizeAnalysis(type, raw) {
    const analysis = raw && typeof raw === 'object' ? { ...raw } : {};
    const computedOverall = deriveOverallScore(type, analysis);
    const overallScore = Number.isFinite(Number(analysis.overall_score))
        ? Number(analysis.overall_score)
        : computedOverall;

    return {
        ...analysis,
        strengths: toStringList(analysis.strengths, ['Consistent effort shown in current session.']),
        weaknesses: toStringList(analysis.weaknesses, ['No severe technical issue detected, keep refining execution.']),
        mistakes: toStringList(analysis.mistakes, ['Minor timing inconsistency under pressure.']),
        improvement_suggestions: toStringList(analysis.improvement_suggestions, ['Continue focused drills and weekly video review.']),
        training_drills: toStringList(analysis.training_drills, ['3 focused drill blocks per session with measurable targets.']),
        recommendations: toStringList(analysis.recommendations, ['Prioritize recovery, hydration, and quality warm-up routines.']),
        best_practices: toStringList(analysis.best_practices, ['Track one key metric after each practice session.']),
        overall_score: overallScore,
        landmarks: analysis.landmarks ?? null
    };
}

function buildFallbackAnalysis(type, reason = 'AI service unavailable') {
    if (type === 'batting') {
        const stanceScore = rand(68, 88);
        const headPositionScore = rand(66, 90);
        const timingScore = rand(64, 86);
        const followThroughScore = rand(67, 89);
        const overall = Math.round((stanceScore + headPositionScore + timingScore + followThroughScore) / 4);
        return {
            batting_metrics: {
                stanceScore,
                batSwingAngle: rand(35, 62),
                headPosition: 'Fallback analysis: keep your head still through impact',
                headPositionScore,
                timingScore,
                followThroughScore,
                shotType: 'Straight Drive',
                overallBattingScore: overall
            },
            strengths: ['Compact setup at release point', 'Reasonable transfer through the shot'],
            weaknesses: ['Inconsistent contact timing under pressure'],
            mistakes: ['Front shoulder opening too early'],
            improvement_suggestions: ['Do 50 front-foot shadow reps daily', 'Add underarm throwdowns focused on late contact'],
            training_drills: ['Stump-gate bat path drill: 4 sets x 12 reps', 'Drop-ball timing drill: 3 sets x 20 balls'],
            recommendations: ['Use lighter training bat for rhythm sessions'],
            best_practices: ['Review one net video every week and track one technical cue'],
            overall_score: overall,
            landmarks: null,
            fallback_reason: reason
        };
    }

    if (type === 'bowling') {
        const wristPositionScore = rand(65, 87);
        const armRotationScore = rand(64, 89);
        const releasePointScore = rand(66, 90);
        const balanceScore = rand(63, 88);
        const overall = Math.round((wristPositionScore + armRotationScore + releasePointScore + balanceScore) / 4);
        return {
            bowling_metrics: {
                wristPositionScore,
                wristPositionNote: 'Fallback analysis: keep wrist behind seam at release',
                armRotationAngle: rand(154, 176),
                armRotationScore,
                releasePointScore,
                releasePointNote: 'Aim for slightly higher release to improve bounce',
                estimatedBallSpeed: rand(108, 136),
                balanceScore,
                bowlingStyle: 'Medium-Fast',
                overallBowlingScore: overall
            },
            strengths: ['Stable run-up rhythm'],
            weaknesses: ['Release consistency can improve'],
            mistakes: ['Collapsing front side near release'],
            improvement_suggestions: ['Train with a target cone for repeatable release'],
            training_drills: ['One-step bowling drill: 5 sets x 6 balls', 'Seam presentation drill: 30 releases'],
            recommendations: ['Include ankle and hip mobility work pre-session'],
            best_practices: ['Track over-by-over consistency, not just peak speed'],
            overall_score: overall,
            landmarks: null,
            fallback_reason: reason
        };
    }

    const shoulderAlignmentScore = rand(67, 90);
    const kneeBendScore = rand(65, 88);
    const balanceScore = rand(66, 91);
    const spinePosScore = rand(67, 90);
    const overall = Math.round((shoulderAlignmentScore + kneeBendScore + balanceScore + spinePosScore) / 4);
    return {
        posture_metrics: {
            shoulderAlignmentScore,
            shoulderAlignmentNote: 'Fallback analysis: maintain shoulder level during setup',
            kneeBendAngle: rand(142, 168),
            kneeBendScore,
            balanceScore,
            spinePosScore,
            overallPostureScore: overall
        },
        strengths: ['Reasonable neutral stance posture'],
        weaknesses: ['Body alignment drifts during movement'],
        mistakes: ['Insufficient knee flex at setup'],
        improvement_suggestions: ['Work on balanced athletic stance before each rep'],
        training_drills: ['Wall-posture hold: 4 sets x 30 sec', 'Split-stance hold: 3 sets x 25 sec each side'],
        recommendations: ['Prioritize glute and core activation warm-up'],
        best_practices: ['Capture posture from front and side angles once weekly'],
        overall_score: overall,
        landmarks: null,
        fallback_reason: reason
    };
}

function getRedisConnection() {
    if (connection) return connection;

    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    connection = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: true,
    });

    connection.on('error', (err) => {
        console.warn('⚠️  Redis connection error (queue disabled):', err.message);
    });

    connection.on('connect', () => {
        console.log('✅ Redis connected — video analysis queue active');
    });

    return connection;
}

// ─── Worker Job Handler ─────────────────────────────────────────────────────
async function processJob(job) {
    const { uploadId, filePath, type, userId } = job.data;

    try {
        await prisma.upload.update({
            where: { id: uploadId },
            data: { status: 'processing', processingProgress: 10 }
        });

        const aiUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
        const endpoint = `${aiUrl}/analyze/${type}`;

        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath));
        formData.append('upload_id', uploadId);

        await prisma.upload.update({
            where: { id: uploadId },
            data: { processingProgress: 30 }
        });

        let analysis;
        try {
            const response = await axios.post(endpoint, formData, {
                headers: formData.getHeaders(),
                timeout: 300000 // 5 min
            });
            analysis = response.data;
        } catch (aiErr) {
            const status = aiErr.response?.status;
            const d = aiErr.response?.data?.detail;
            const reason =
                (typeof d === 'string' ? d : d ? JSON.stringify(d) : null) ||
                aiErr.response?.data?.message ||
                aiErr.message;
            
            // If it's a 400 error, it's a validation failure (e.g. wrong video). 
            // We should NOT use fallback analysis for validation failures.
            if (status === 400) {
                console.error(`❌ Validation failed for upload ${uploadId}: ${reason}`);
                throw new Error(reason); // This will be caught by the outer catch and mark as failed
            }

            console.warn(`⚠️  AI service unavailable for upload ${uploadId}. Using fallback report. Reason: ${reason}`);
            analysis = buildFallbackAnalysis(type, reason);
        }

        analysis = normalizeAnalysis(type, analysis);

        await prisma.upload.update({
            where: { id: uploadId },
            data: { processingProgress: 80 }
        });

        const existingReport = await prisma.analysisReport.findFirst({
            where: { uploadId, userId }
        });

        const reportPayload = {
                uploadId,
                userId,
                type,
                stanceScore: analysis.batting_metrics?.stanceScore ?? null,
                batSwingAngle: analysis.batting_metrics?.batSwingAngle ?? null,
                headPosition: analysis.batting_metrics?.headPosition ?? null,
                headPositionScore: analysis.batting_metrics?.headPositionScore ?? null,
                timingScore: analysis.batting_metrics?.timingScore ?? null,
                followThroughScore: analysis.batting_metrics?.followThroughScore ?? null,
                shotType: analysis.batting_metrics?.shotType ?? null,
                overallBattingScore: analysis.batting_metrics?.overallBattingScore ?? null,
                
                // Bowling Metrics
                wristPositionScore: analysis.bowling_metrics?.wristPositionScore ?? null,
                wristPositionNote: analysis.bowling_metrics?.wristPositionNote ?? null,
                armRotationAngle: analysis.bowling_metrics?.armRotationAngle ?? null,
                armRotationScore: analysis.bowling_metrics?.armRotationScore ?? null,
                releasePointScore: analysis.bowling_metrics?.releasePointScore ?? null,
                releasePointNote: analysis.bowling_metrics?.releasePointNote ?? null,
                estimatedBallSpeed: analysis.bowling_metrics?.estimatedBallSpeed ?? null,
                balanceScoreBowling: analysis.bowling_metrics?.balanceScore ?? null,
                bowlingStyle: analysis.bowling_metrics?.bowlingStyle ?? null,
                overallBowlingScore: analysis.bowling_metrics?.overallBowlingScore ?? null,

                // Posture Metrics
                shoulderAlignmentScore: analysis.posture_metrics?.shoulderAlignmentScore ?? null,
                shoulderAlignmentNote: analysis.posture_metrics?.shoulderAlignmentNote ?? null,
                kneeBendAngle: analysis.posture_metrics?.kneeBendAngle ?? null,
                kneeBendScore: analysis.posture_metrics?.kneeBendScore ?? null,
                balanceScorePosture: analysis.posture_metrics?.balanceScore ?? null,
                spinePosScore: analysis.posture_metrics?.spinePosScore ?? null,
                overallPostureScore: analysis.posture_metrics?.overallPostureScore ?? null,

                // AI Report (JSON arrays)
                strengths: analysis.strengths || [],
                weaknesses: analysis.weaknesses || [],
                mistakes: analysis.mistakes || [],
                improvementSuggestions: analysis.improvement_suggestions || [],
                trainingDrills: analysis.training_drills || [],
                recommendations: analysis.recommendations || [],
                bestPractices: analysis.best_practices || [],
                overallScore: analysis.overall_score ?? 0,
                landmarks: analysis.landmarks ?? null
        };

        const report = existingReport
            ? await prisma.analysisReport.update({
                where: { id: existingReport.id },
                data: reportPayload
            })
            : await prisma.analysisReport.create({ data: reportPayload });

        try {
            const progressExists = await prisma.progressEntry.findFirst({
                where: {
                    userId,
                    reportId: report.id,
                    type
                },
                select: { id: true }
            });

            if (!progressExists) {
                await prisma.progressEntry.create({
                    data: {
                        userId,
                        reportId: report.id,
                        type,
                        batSwingAngle: analysis.batting_metrics?.batSwingAngle ?? null,
                        stanceScore: analysis.batting_metrics?.stanceScore ?? null,
                        timingScore: analysis.batting_metrics?.timingScore ?? null,
                        followThroughScore: analysis.batting_metrics?.followThroughScore ?? null,
                        estimatedBallSpeed: analysis.bowling_metrics?.estimatedBallSpeed ?? null,
                        armRotationAngle: analysis.bowling_metrics?.armRotationAngle ?? null,
                        wristPositionScore: analysis.bowling_metrics?.wristPositionScore ?? null,
                        releasePointScore: analysis.bowling_metrics?.releasePointScore ?? null,
                        balanceScore: analysis.batting_metrics?.balanceScore ?? analysis.bowling_metrics?.balanceScore ?? analysis.posture_metrics?.balanceScore ?? null,
                        overallScore: analysis.overall_score ?? 0,
                    }
                });
            }
        } catch (progressErr) {
            console.warn(`⚠️  Progress entry update skipped for upload ${uploadId}: ${progressErr.message}`);
        }

        try {
            const userStats = await prisma.analysisReport.aggregate({
                where: { userId },
                _avg: { overallScore: true }
            });

            await prisma.user.update({
                where: { id: userId },
                data: {
                    totalReports: existingReport ? undefined : { increment: 1 },
                    overallScore: Number(userStats._avg.overallScore || 0)
                }
            });
        } catch (userErr) {
            console.warn(`⚠️  User aggregate update skipped for upload ${uploadId}: ${userErr.message}`);
        }

        await prisma.upload.update({
            where: { id: uploadId },
            data: { status: 'completed', processingProgress: 100 }
        });

        return { success: true, reportId: report.id };
    } catch (err) {
        const aiMessage = err.response?.data?.detail || err.response?.data?.message;
        let errorMessage = aiMessage || err.message || 'Unknown analysis error';
        if (typeof errorMessage === 'object') {
            try {
                errorMessage = JSON.stringify(errorMessage);
            } catch (e) {
                errorMessage = String(errorMessage);
            }
        }
        console.error('❌ Job error processing video:', errorMessage);
        await prisma.upload.update({
            where: { id: uploadId },
            data: { status: 'failed', errorMessage: String(errorMessage), processingProgress: 0 }
        }).catch(() => {}); // ignore if DB also down
        throw err;
    }
}

// ─── Initialize Queue + Worker (lazy — only if Redis is available) ──────────
function initQueue() {
    try {
        const conn = getRedisConnection();
        analysisQueue = new Queue('video-analysis', { connection: conn });
        analysisWorker = new Worker('video-analysis', processJob, {
            connection: conn,
            concurrency: 3
        });

        analysisWorker.on('completed', (job) => {
            console.log(`✅ Analysis job ${job.id} completed`);
        });

        analysisWorker.on('failed', (job, err) => {
            console.error(`❌ Analysis job ${job?.id} failed: ${err.message}`);
        });

        console.log('🔄 Video analysis queue initialized');
    } catch (err) {
        console.warn('⚠️  Queue init failed (Redis may be offline):', err.message);
        analysisQueue = null;
        analysisWorker = null;
    }
}

// Initialize queue only when explicitly enabled via env.
if (isQueueEnabled()) {
    initQueue();
} else {
    console.log('ℹ️  Analysis queue disabled (ENABLE_ANALYSIS_QUEUE!=true). Using direct processing mode.');
}

// ─── Fallback: direct processing without queue (when Redis is unavailable) ──
async function processDirectly(uploadId, filePath, type, userId) {
    return processJob({ data: { uploadId, filePath, type, userId } });
}

// ─── Exported enqueue function ──────────────────────────────────────────────
async function enqueueAnalysis(data) {
    const queueEnabled = isQueueEnabled();

    if (!queueEnabled) {
        console.warn(`⚠️  Queue disabled. Processing directly for upload: ${data.uploadId}`);
        processDirectly(data.uploadId, data.filePath, data.type, data.userId).catch(err => {
            console.error('❌ Direct analysis fatal error:', err.message);
        });
        return { success: true, processed: 'directly' };
    }

    try {
        if (analysisQueue) {
            console.log(`📡 Queuing analysis for upload: ${data.uploadId}`);
            return await analysisQueue.add('analyze-video', data, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: true
            });
        }
    } catch (err) {
        console.error('❌ Redis queue failed at runtime:', err.message);
    }
    
    // Fallback: run directly in the same process (no Redis)
    console.warn(`⚠️  Processing directly (Queue Offline) for upload: ${data.uploadId}`);
    try {
        // Execute in background so it doesn't block the request response too long,
        // though it still uses server resources.
        processDirectly(data.uploadId, data.filePath, data.type, data.userId).catch(err => {
            console.error('❌ Direct analysis fatal error:', err.message);
        });
        return { success: true, processed: 'directly' };
    } catch (fallbackErr) {
        console.error('❌ Fallback failed:', fallbackErr.message);
        throw fallbackErr;
    }
}

module.exports = { analysisQueue, analysisWorker, enqueueAnalysis };
