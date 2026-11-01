const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const prisma = require('./prisma');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { aiServiceUrl, aiAuthHeaders, waitForAiService } = require('./aiService');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// Per-attempt timeout for the AI call. Must exceed the AI service's own
// REQUEST_TIMEOUT_SECS (480s) so the backend never gives up while it is still working.
const AI_REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS) || 600000;

const dns = require('dns').promises;
const url = require('url');

// Validates the AI_SERVICE_URL configuration
async function validateAiServiceUrl(aiUrl) {
    if (!aiUrl) {
        throw new Error('AI_SERVICE_URL is not configured in environment variables.');
    }
    try {
        const parsed = new url.URL(aiUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error(`Invalid protocol in AI_SERVICE_URL: ${parsed.protocol}`);
        }
        await dns.lookup(parsed.hostname);
        return true;
    } catch (err) {
        throw new Error(`AI_SERVICE_URL DNS resolution / validation failed: ${err.message}`);
    }
}

// The AI service is unreachable or still waking up (e.g. a sleeping free-tier instance).
// Retrying makes sense; a timeout does not, because the service may still be crunching the first request.
function isServiceWakingError(err) {
    const status = err?.response?.status;
    return (
        err?.code === 'ECONNREFUSED' ||
        err?.code === 'ECONNRESET' ||
        err?.code === 'EPIPE' ||
        err?.code === 'UND_ERR_SOCKET' ||
        /socket hang up/i.test(err?.message || '') ||
        status === 429 ||   // Render's edge answers 429 while a sleeping service boots
        status === 502 ||
        status === 503
    );
}

// Delay before the next attempt: the server's Retry-After when given, else backoff.
function retryDelayMs(err, fallback) {
    const retryAfter = Number(err?.response?.headers?.['retry-after']);
    return Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60000) : fallback;
}

// POST to the AI service with backoff. `buildForm` is called for every attempt because a
// multipart stream can only be sent once — reusing it would post an empty body on retry.
async function callAiWithRetry(endpoint, buildForm, uploadId, maxAttempts = 5) {
    const aiUrl = aiServiceUrl();

    console.log(`[AI_REQUEST:START] Starting AI analysis for upload ${uploadId} to endpoint: ${endpoint}`);

    await validateAiServiceUrl(aiUrl);

    let lastError = null;
    let delay = 5000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`[AI_REQUEST:ATTEMPT] Attempt ${attempt} of ${maxAttempts} to call AI service for upload ${uploadId}`);

            const formData = buildForm();
            const startTime = Date.now();
            const response = await axios.post(endpoint, formData, {
                headers: { ...formData.getHeaders(), ...aiAuthHeaders() },
                timeout: AI_REQUEST_TIMEOUT_MS,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            });
            
            const duration = Date.now() - startTime;
            console.log(`[AI_RESPONSE:SUCCESS] Received response from AI service in ${duration}ms for upload ${uploadId}`);
            
            if (!response.data) {
                throw new Error('AI service returned empty response');
            }
            
            return response.data;
        } catch (err) {
            lastError = err;
            
            // Step 8: Detect error types
            let errorType = 'UNKNOWN';
            const status = err.response?.status;
            
            if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || /timeout/i.test(err.message || '')) {
                errorType = 'TIMEOUT';
            } else if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.code === 'UND_ERR_SOCKET' || /socket hang up/i.test(err.message || '')) {
                errorType = 'CONNECTION_REFUSED';
            } else if (status === 429 || status === 502 || status === 503) {
                errorType = 'SERVICE_SLEEPING_OR_BAD_GATEWAY';
            } else if (status && status !== 200) {
                errorType = 'INVALID_RESPONSE';
            }
            
            console.warn(`[AI_REQUEST:FAIL] Attempt ${attempt} failed with ${errorType} for upload ${uploadId}. Error: ${err.message}`);
            
            if (!isServiceWakingError(err)) break;
            if (attempt < maxAttempts) {
                const wait = retryDelayMs(err, delay);
                console.log(`[AI_REQUEST:RETRY] Retrying in ${wait}ms...`);
                await new Promise(resolve => setTimeout(resolve, wait));
                delay = Math.min(delay * 2, 60000); // exponential backoff
                // A booting service can take a minute or more: wait for /health before re-sending the video.
                await waitForAiService({ timeoutMs: 120000 });
            }
        }
    }
    
    throw lastError;
}

// ─── Redis Connection ──────────────────────────────────────────────────────
let connection = null;
let analysisQueue = null;
let analysisWorker = null;

function isQueueEnabled() {
    return String(process.env.ENABLE_ANALYSIS_QUEUE || '').toLowerCase() === 'true';
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
        // No invented fallback text: an empty list means the engine had nothing to say.
        strengths: toStringList(analysis.strengths),
        weaknesses: toStringList(analysis.weaknesses),
        mistakes: toStringList(analysis.mistakes),
        improvement_suggestions: toStringList(analysis.improvement_suggestions),
        training_drills: toStringList(analysis.training_drills),
        recommendations: toStringList(analysis.recommendations),
        best_practices: toStringList(analysis.best_practices),
        overall_score: overallScore,
        landmarks: analysis.landmarks ?? null
    };
}

/**
 * Returns a structured error payload when the AI service is unavailable.
 * IMPORTANT: This function does NOT generate fake or random scores.
 * All biomechanical scores must come from real pose analysis.
 * If the AI service is unavailable, the upload status is kept as 'pending'
 * and the user is informed clearly.
 */
function buildFallbackAnalysis(type, reason = 'AI service unavailable') {
    return {
        success: false,
        fallback: true,
        fallback_reason: reason,
        message: 'Analysis could not be completed — your video has been saved and will be re-analysed automatically.',
        overall_score: 0,
        landmarks: null,
        strengths: [],
        weaknesses: [],
        mistakes: [],
        improvement_suggestions: ['Re-upload your video once the service is back online for a real analysis.'],
        training_drills: [],
        recommendations: [],
        best_practices: [],
    };
}

/**
 * Resolve the Redis connection URL from multiple possible env sources.
 * Priority:
 *   1. REDIS_URL  (standard Redis connection string)
 *   2. Auto-constructed from UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *      (Upstash free tier exposes REST credentials — we convert them to IORedis format)
 */
function getRedisUrl() {
    if (process.env.REDIS_URL) return process.env.REDIS_URL;

    const restUrl   = process.env.UPSTASH_REDIS_REST_URL;
    const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (restUrl && restToken) {
        // Convert https://host.upstash.io → rediss://default:<token>@host.upstash.io:6380
        const host = restUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const url = `rediss://default:${restToken}@${host}:6380`;
        console.log(`ℹ️  Redis URL auto-constructed from Upstash credentials (host: ${host})`);
        return url;
    }

    return null;
}

function getRedisConnection() {
    if (connection) return connection;

    const redisUrl = getRedisUrl();
    if (!redisUrl) {
        console.warn('⚠️  No Redis URL found (REDIS_URL or UPSTASH_* not set) — queue disabled');
        return null;
    }

    connection = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: true,
        tls: redisUrl.startsWith('rediss://') ? {} : undefined,
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
// Supports both in-memory buffer (initial upload) and Cloudinary URL (retry).
async function processJob(job) {
    const { uploadId, fileUrl, filePath, fileName, mimeType, type, userId } = job.data;

    try {
        await prisma.upload.update({
            where: { id: uploadId },
            data: { status: 'processing', processingProgress: 10, errorMessage: null }
        });

        const endpoint = `${aiServiceUrl()}/analyze/${type}`;

        // Wake the AI service before sending the video: a sleeping free-tier instance
        // answers 429/503 for a minute or more while it boots.
        const awake = await waitForAiService({
            onWaiting: () => prisma.upload.update({
                where: { id: uploadId },
                data: { processingProgress: 15, errorMessage: 'Starting the analysis engine — this can take up to a minute.' }
            }).catch(() => {})
        });
        if (!awake) {
            const err = new Error('AI analysis service did not start in time');
            err.response = { status: 503 };   // treated as "unavailable": upload stays pending and is retried
            throw err;
        }

        // Locally stored files are streamed from disk; cloud files are fetched by the AI service.
        const hasLocalFile = Boolean(filePath && fs.existsSync(filePath));
        if (filePath && !hasLocalFile) {
            console.warn(`⚠️  Local file not found at path: ${filePath}`);
        }
        if (!hasLocalFile && !(fileUrl && fileUrl.startsWith('https://'))) {
            throw new Error('No local file and no cloud URL available. Re-upload the file to retry.');
        }

        // Handedness lets the engine track the correct (front/bowling) side of the body.
        const profile = await prisma.user.findUnique({
            where: { id: userId },
            select: { battingStyle: true, bowlingStyle: true }
        }).catch(() => null);

        const buildForm = () => {
            const formData = new FormData();
            if (hasLocalFile) {
                formData.append('file', fs.createReadStream(filePath), {
                    filename: fileName || path.basename(filePath),
                    contentType: mimeType || (type === 'posture' ? 'image/jpeg' : 'video/mp4'),
                });
            } else {
                formData.append('fileUrl', fileUrl);
            }
            formData.append('upload_id', uploadId);
            if (profile?.battingStyle) formData.append('batting_style', profile.battingStyle);
            if (profile?.bowlingStyle) formData.append('bowling_style', profile.bowlingStyle);
            return formData;
        };

        await prisma.upload.update({
            where: { id: uploadId },
            data: { processingProgress: 30 }
        });

        let analysis;
        try {
            analysis = await callAiWithRetry(endpoint, buildForm, uploadId);
        } catch (aiErr) {
            if (isServiceWakingError(aiErr)) {
                // AI service unreachable. Keep upload as pending; the recovery sweep re-queues it.
                // Do NOT generate fake scores — real analysis requires real pose detection.
                console.warn(`⚠️  AI service temporarily unavailable for upload ${uploadId}. Keeping as pending for retry.`);
                await prisma.upload.update({
                    where: { id: uploadId },
                    data: {
                        status: 'pending',
                        errorMessage: 'AI analysis service is currently unavailable. Your upload has been saved and analysis will resume automatically.',
                        processingProgress: 0
                    }
                }).catch((dbErr) => {
                    console.error(`[DB_WRITE:ERROR] Failed to update transient error status: ${dbErr.message}`);
                });
                return { success: false, reason: 'AI service unavailable, status kept as pending' };
            } else {
                const timedOut = aiErr.code === 'ECONNABORTED' || aiErr.response?.status === 504;
                if (timedOut) {
                    throw new Error('Analysis took too long. Upload a shorter clip (under 30 seconds) focused on a single shot or delivery.');
                }
                const d = aiErr.response?.data?.detail;
                const reason =
                    (typeof d === 'string' ? d : d ? JSON.stringify(d) : null) ||
                    aiErr.response?.data?.message ||
                    aiErr.message;
                console.error(`❌ AI Analysis failed for upload ${uploadId}: ${reason}`);
                throw new Error(reason);
            }
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

            // ── Batting Temporal Metrics ─────────────────────────────────────────
            headStabilityScore: analysis.batting_metrics?.headStabilityScore ?? null,
            headStabilityVariance: analysis.batting_metrics?.headStabilityVariance ?? null,
            timingScore: analysis.batting_metrics?.timingScore ?? null,
            peakKneeFlexion: analysis.batting_metrics?.peakKneeFlexion ?? null,
            peakKneeExtension: analysis.batting_metrics?.peakKneeExtension ?? null,
            rangeOfMotion: analysis.batting_metrics?.rangeOfMotion ?? null,
            followThroughScore: analysis.batting_metrics?.followThroughScore ?? null,
            wristYDelta: analysis.batting_metrics?.wristYDelta ?? null,
            strideScore: analysis.batting_metrics?.strideScore ?? null,
            avgStrideRatio: analysis.batting_metrics?.avgStrideRatio ?? null,

            // ── Batting Single-Frame Metrics ──────────────────────────────────────
            stanceScore: analysis.batting_metrics?.stanceScore ?? null,
            batSwingAngle: analysis.batting_metrics?.batSwingAngle ?? null,
            wristPositionScore: analysis.batting_metrics?.wristPositionScore ?? analysis.bowling_metrics?.wristPositionScore ?? null,
            headPosition: analysis.batting_metrics?.headPosition ?? null,
            headPositionScore: analysis.batting_metrics?.headPositionScore ?? null,
            shotType: analysis.batting_metrics?.shotType ?? null,
            overallBattingScore: analysis.batting_metrics?.overallBattingScore ?? null,

            // ── Bowling Metrics ───────────────────────────────────────────────────
            armSmoothnessScore: analysis.bowling_metrics?.armSmoothnessScore ?? null,
            avgJerk: analysis.bowling_metrics?.avgJerk ?? null,
            releasePointScore: analysis.bowling_metrics?.releasePointScore ?? null,
            peakWristY: analysis.bowling_metrics?.peakWristY ?? null,
            releaseArmAngle: analysis.bowling_metrics?.releaseArmAngle ?? null,
            wristPositionNote: analysis.bowling_metrics?.wristPositionNote ?? null,
            armRotationAngle: analysis.bowling_metrics?.armRotationAngle ?? null,
            armRotationScore: analysis.bowling_metrics?.armRotationScore ?? null,
            releasePointNote: analysis.bowling_metrics?.releasePointNote ?? null,
            estimatedBallSpeed: analysis.bowling_metrics?.estimatedBallSpeed ?? null,
            speedClassification: analysis.bowling_metrics?.speedClassification ?? null,
            balanceScoreBowling: analysis.bowling_metrics?.balanceScore ?? null,
            bowlingStyle: analysis.bowling_metrics?.bowlingStyle ?? null,
            overallBowlingScore: analysis.bowling_metrics?.overallBowlingScore ?? null,

            // ── Posture Metrics ───────────────────────────────────────────────────
            shoulderAlignmentScore: analysis.posture_metrics?.shoulderAlignmentScore ?? null,
            shoulderAlignmentNote: analysis.posture_metrics?.shoulderAlignmentNote ?? null,
            kneeBendAngle: analysis.posture_metrics?.kneeBendAngle ?? null,
            kneeBendScore: analysis.posture_metrics?.kneeBendScore ?? null,
            balanceScorePosture: analysis.posture_metrics?.balanceScore ?? null,
            spinePosScore: analysis.posture_metrics?.spinePosScore ?? null,
            overallPostureScore: analysis.posture_metrics?.overallPostureScore ?? null,

            // ── Shared Balance (temporal) ─────────────────────────────────────────
            balanceScore: analysis.batting_metrics?.balanceScore ?? analysis.bowling_metrics?.balanceScore ?? analysis.posture_metrics?.balanceScore ?? null,
            avgHipTilt: analysis.batting_metrics?.avgHipTilt ?? analysis.bowling_metrics?.avgHipTilt ?? null,
            avgSpineOffset: analysis.batting_metrics?.avgSpineOffset ?? null,

            // ── AI Report (JSON arrays) ───────────────────────────────────────────
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

        if (existingReport) {
            await prisma.rawFrameMetric.deleteMany({ where: { reportId: existingReport.id } }).catch(e => console.warn('⚠️  Could not clean rawFrameMetrics:', e.message));
            await prisma.aggregateMetric.deleteMany({ where: { reportId: existingReport.id } }).catch(e => console.warn('⚠️  Could not clean aggregateMetrics:', e.message));
            await prisma.faultLog.deleteMany({ where: { reportId: existingReport.id } }).catch(e => console.warn('⚠️  Could not clean faultLog:', e.message));
        }

        const report = existingReport
            ? await prisma.analysisReport.update({
                where: { id: existingReport.id },
                data: reportPayload
            })
            : await prisma.analysisReport.create({ data: reportPayload });

        console.log(`[DB_WRITE:INFO] ${existingReport ? 'Updated' : 'Created'} analysis report with ID ${report.id} for upload ${uploadId}`);

        // Save RawFrameMetric records
        if (analysis.raw_frame_metrics && Array.isArray(analysis.raw_frame_metrics)) {
            try {
                const rawMetrics = analysis.raw_frame_metrics.map(fm => ({
                    uploadId,
                    reportId: report.id,
                    frameIndex: fm.frameIndex,
                    frameType: fm.frameType,
                    landmarks: fm.landmarks ?? null,
                    leftKneeAngle: fm.leftKneeAngle ?? null,
                    rightKneeAngle: fm.rightKneeAngle ?? null,
                    leftElbowAngle: fm.leftElbowAngle ?? null,
                    rightElbowAngle: fm.rightElbowAngle ?? null,
                    shoulderTilt: fm.shoulderTilt ?? null,
                    hipTilt: fm.hipTilt ?? null,
                    spineOffset: fm.spineOffset ?? null,
                    wristY: fm.wristY ?? null,
                    noseY: fm.noseY ?? null,
                    ankleSpread: fm.ankleSpread ?? null,
                }));
                await prisma.rawFrameMetric.createMany({ data: rawMetrics });
                console.log(`[DB_WRITE:INFO] Saved ${rawMetrics.length} RawFrameMetric records`);
            } catch (rawErr) {
                console.error('⚠️  Failed to save RawFrameMetric records:', rawErr.message);
            }
        }

        // Save AggregateMetric record
        try {
            const b = analysis.batting_metrics || {};
            const bw = analysis.bowling_metrics || {};
            const p = analysis.posture_metrics || {};

            await prisma.aggregateMetric.create({
                data: {
                    reportId: report.id,
                    headStabilityScore: b.headStabilityScore ?? null,
                    headStabilityVariance: b.headStabilityVariance ?? null,
                    balanceScore: b.balanceScore ?? bw.balanceScore ?? p.balanceScore ?? null,
                    avgHipTilt: b.avgHipTilt ?? bw.avgHipTilt ?? null,
                    avgSpineOffset: b.avgSpineOffset ?? null,
                    timingScore: b.timingScore ?? null,
                    peakKneeFlexion: b.peakKneeFlexion ?? null,
                    kneeExtensionAtEnd: b.peakKneeExtension ?? null,
                    rangeOfMotion: b.rangeOfMotion ?? null,
                    strideScore: b.strideScore ?? null,
                    avgStrideRatio: b.avgStrideRatio ?? null,
                    armSmoothnessScore: bw.armSmoothnessScore ?? null,
                    avgJerk: bw.avgJerk ?? null,
                    releasePointScore: bw.releasePointScore ?? null,
                    peakWristY: bw.peakWristY ?? null,
                    followThroughScore: b.followThroughScore ?? null,
                    wristYDelta: b.wristYDelta ?? null,
                    detectedShotType: b.shotType ?? null,
                    bowlingStyle: bw.bowlingStyle ?? null,
                }
            });
            console.log(`[DB_WRITE:INFO] Saved AggregateMetric record`);
        } catch (aggErr) {
            console.error('⚠️  Failed to save AggregateMetric record:', aggErr.message);
        }

        // Save FaultLog records
        if (analysis.faults && Array.isArray(analysis.faults)) {
            try {
                const faultLogs = analysis.faults.map(f => ({
                    reportId: report.id,
                    faultCode: f.faultCode,
                    faultText: f.faultText,
                    metric: f.metric,
                    value: f.value ?? null,
                    threshold: f.threshold ?? null,
                    severity: f.severity || 'moderate',
                }));
                await prisma.faultLog.createMany({ data: faultLogs });
                console.log(`[DB_WRITE:INFO] Saved ${faultLogs.length} FaultLog records`);
            } catch (faultErr) {
                console.error('⚠️  Failed to save FaultLog records:', faultErr.message);
            }
        }

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
                const newProgress = await prisma.progressEntry.create({
                    data: {
                        userId,
                        reportId: report.id,
                        type,
                        // Batting temporal metrics
                        headStabilityScore: analysis.batting_metrics?.headStabilityScore ?? null,
                        timingScore: analysis.batting_metrics?.timingScore ?? null,
                        followThroughScore: analysis.batting_metrics?.followThroughScore ?? null,
                        strideScore: analysis.batting_metrics?.strideScore ?? null,
                        balanceScore: analysis.batting_metrics?.balanceScore ?? analysis.bowling_metrics?.balanceScore ?? analysis.posture_metrics?.balanceScore ?? null,
                        // Batting single-frame
                        batSwingAngle: analysis.batting_metrics?.batSwingAngle ?? null,
                        stanceScore: analysis.batting_metrics?.stanceScore ?? null,
                        // Bowling metrics
                        estimatedBallSpeed: analysis.bowling_metrics?.estimatedBallSpeed ?? null,
                        armRotationAngle: analysis.bowling_metrics?.armRotationAngle ?? null,
                        wristPositionScore: analysis.bowling_metrics?.wristPositionScore ?? null,
                        releasePointScore: analysis.bowling_metrics?.releasePointScore ?? null,
                        armSmoothnessScore: analysis.bowling_metrics?.armSmoothnessScore ?? null,
                        overallScore: analysis.overall_score ?? 0,
                    }
                });
                console.log(`[DB_WRITE:INFO] Created progress entry with ID ${newProgress.id} for user ${userId}`);
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
            console.log(`[DB_WRITE:INFO] Updated stats for user ${userId}: average overallScore = ${userStats._avg.overallScore}`);
        } catch (userErr) {
            console.warn(`⚠️  User aggregate update skipped for upload ${uploadId}: ${userErr.message}`);
        }

        await prisma.upload.update({
            where: { id: uploadId },
            data: { status: 'completed', processingProgress: 100, errorMessage: null }
        });
        console.log(`[DB_WRITE:INFO] Updated upload ${uploadId} status to completed`);
        recoveryAttempts.delete(uploadId);

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
        
        const isUnavailable = isServiceWakingError(err);
        
        const status = isUnavailable ? 'pending' : 'failed';
        const finalErrorMessage = isUnavailable 
            ? 'AI analysis service is currently unavailable. Your upload has been saved and analysis will resume automatically.'
            : String(errorMessage);
            
        console.log(`[DB_WRITE:INFO] AI Analysis fatal catch. Updating upload ${uploadId} status to ${status}. Message: "${finalErrorMessage}"`);

        await prisma.upload.update({
            where: { id: uploadId },
            data: { status, errorMessage: finalErrorMessage, processingProgress: 0 }
        }).catch((dbErr) => {
            console.error(`[DB_WRITE:ERROR] Failed in job error handler to update upload ${uploadId}: ${dbErr.message}`);
        });
        throw err;
    }
}

// ─── Initialize Queue + Worker (lazy — only if Redis is available) ──────────
function initQueue() {
    try {
        const conn = getRedisConnection();
        if (!conn) {
            console.log('ℹ️  Queue skipped — no Redis URL configured. Using direct processing mode.');
            return;
        }
        analysisQueue = new Queue('video-analysis', {
            connection: conn,
            defaultJobOptions: {
                attempts: 1,   // transient AI outages are re-queued by the recovery sweep
                backoff: { type: 'exponential', delay: 8000 },
                removeOnComplete: true,
            }
        });
        analysisWorker = new Worker('video-analysis', processJob, {
            connection: conn,
            concurrency: 1,         // 1 at a time — prevents RAM overload on free tier
            lockDuration: 660000,   // 11 min lock, renewed below while the AI call runs
            lockRenewTime: 120000,  // Renew lock every 2 min to keep job alive
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

// ─── Direct mode: in-process serial runner ───────────────────────────────────
// Without Redis, jobs still run one (or DIRECT_CONCURRENCY) at a time so a burst of
// uploads cannot overload the CPU-bound AI service.
const DIRECT_CONCURRENCY = Math.max(1, Number(process.env.DIRECT_CONCURRENCY) || 1);
const activeUploads = new Set();
const pendingJobs = [];
let runningJobs = 0;

function drainDirectQueue() {
    while (runningJobs < DIRECT_CONCURRENCY && pendingJobs.length) {
        const data = pendingJobs.shift();
        runningJobs++;
        processJob({ data })
            .catch(err => console.error(`❌ Direct analysis failed for upload ${data.uploadId}:`, err.message))
            .finally(() => {
                runningJobs--;
                activeUploads.delete(data.uploadId);
                drainDirectQueue();
            });
    }
}

function runDirectly(data) {
    if (activeUploads.has(data.uploadId)) {
        return { success: true, processed: 'already-queued' };
    }
    activeUploads.add(data.uploadId);
    pendingJobs.push(data);
    drainDirectQueue();
    return { success: true, processed: 'directly', position: pendingJobs.length };
}

// Build the job payload for an upload row (used by upload, retry and recovery).
function buildJobData(upload) {
    const isLocalFile = upload.fileUrl && upload.fileUrl.startsWith('/uploads/');
    return {
        uploadId: upload.id,
        fileUrl: upload.fileUrl,
        filePath: isLocalFile ? path.join(UPLOADS_DIR, path.basename(upload.filename)) : null,
        fileName: upload.originalName,
        mimeType: upload.mimeType,
        type: upload.type,
        userId: upload.userId,
    };
}

// ─── Exported enqueue function ───────────────────────────────────────────────
async function enqueueAnalysis(data) {
    if (isQueueEnabled() && analysisQueue) {
        try {
            console.log(`📡 Queuing analysis for upload: ${data.uploadId}`);
            // jobId = uploadId de-duplicates re-queues of the same upload.
            return await analysisQueue.add('analyze-video', data, {
                jobId: data.uploadId,
                attempts: 1,
                removeOnComplete: true,
                removeOnFail: true,
            });
        } catch (err) {
            console.error('❌ Redis queue failed at runtime, falling back to direct mode:', err.message);
        }
    }

    console.log(`⚙️  Processing directly for upload: ${data.uploadId}`);
    return runDirectly(data);
}

// ─── Recovery sweep ──────────────────────────────────────────────────────────
// Uploads left 'pending' (AI service was down) or stuck 'processing' (server restarted
// mid-job) are re-queued, up to MAX_RECOVERY_ATTEMPTS, then marked failed.
const MAX_RECOVERY_ATTEMPTS = Number(process.env.MAX_RECOVERY_ATTEMPTS) || 3;
const STALE_AFTER_MS = 2 * 60 * 1000;
const recoveryAttempts = new Map();

async function recoverStalledUploads({ includeProcessing = false } = {}) {
    try {
        const cutoff = new Date(Date.now() - STALE_AFTER_MS);
        const statuses = includeProcessing ? ['pending', 'processing'] : ['pending'];
        const stalled = await prisma.upload.findMany({
            where: { status: { in: statuses }, updatedAt: { lt: cutoff } },
            orderBy: { createdAt: 'asc' },
            take: 20,
        });

        for (const upload of stalled) {
            if (activeUploads.has(upload.id)) continue;
            if (isQueueEnabled() && analysisQueue) {
                const queued = await analysisQueue.getJob(upload.id).catch(() => null);
                if (queued) continue;
            }

            const attempts = (recoveryAttempts.get(upload.id) || 0) + 1;
            if (attempts > MAX_RECOVERY_ATTEMPTS) {
                recoveryAttempts.delete(upload.id);
                await prisma.upload.update({
                    where: { id: upload.id },
                    data: {
                        status: 'failed',
                        processingProgress: 0,
                        errorMessage: 'AI analysis service did not respond after several attempts. Use Retry to try again.',
                    },
                });
                continue;
            }
            recoveryAttempts.set(upload.id, attempts);
            console.log(`🔁 Re-queuing stalled upload ${upload.id} (attempt ${attempts}/${MAX_RECOVERY_ATTEMPTS})`);
            // Touch updatedAt so the next sweep waits STALE_AFTER_MS again.
            await prisma.upload.update({ where: { id: upload.id }, data: { status: 'pending' } });
            await enqueueAnalysis(buildJobData(upload));
        }
    } catch (err) {
        console.warn('⚠️  Upload recovery sweep failed:', err.message);
    }
}

let sweepTimer = null;
function startRecoverySweep(intervalMs = 60 * 1000) {
    if (sweepTimer) return;
    // On boot, anything still 'processing' belongs to a job that died with the old process.
    recoverStalledUploads({ includeProcessing: true });
    sweepTimer = setInterval(() => recoverStalledUploads(), intervalMs);
    sweepTimer.unref();
}

function resetRecoveryAttempts(uploadId) {
    recoveryAttempts.delete(uploadId);
}

module.exports = { enqueueAnalysis, buildJobData, startRecoverySweep, resetRecoveryAttempts };
