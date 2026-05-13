const express = require('express');
const router = express.Router();
const path = require('path');
const prisma = require('../utils/prisma');
const upload = require('../config/multer');
const { protect } = require('../middleware/auth');
const { uploadBuffer, deleteFile } = require('../config/cloudinary');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

function matchesExpectedMedia(type, file) {
    const ext = path.extname(file?.originalname || '').toLowerCase();
    const mime = String(file?.mimetype || '').toLowerCase();

    if (type === 'posture') {
        const looksLikeImage = mime.startsWith('image/') || IMAGE_EXTENSIONS.has(ext);
        const looksLikeVideo = mime.startsWith('video/') || VIDEO_EXTENSIONS.has(ext);
        return { valid: looksLikeImage || looksLikeVideo, expected: 'image/* or short posture video (mp4/mov/avi/mkv/webm)' };
    }

    const looksLikeVideo = mime.startsWith('video/') || VIDEO_EXTENSIONS.has(ext);
    return { valid: looksLikeVideo, expected: 'video/* (mp4/mov/avi/mkv/webm)' };
}

// ─── POST /api/uploads — Upload to Cloudinary then queue AI analysis ──────────
router.post('/', protect, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const { type, notes } = req.body;
        if (!['batting', 'bowling', 'posture'].includes(type)) {
            return res.status(400).json({ success: false, message: 'Invalid type. Must be batting, bowling, or posture' });
        }

        const mediaCheck = matchesExpectedMedia(type, req.file);
        if (!mediaCheck.valid) {
            return res.status(400).json({
                success: false,
                message: `Invalid file for ${type} analysis. Expected ${mediaCheck.expected}.`
            });
        }

        // ── Upload buffer to Cloudinary ────────────────────────────────────
        const isVideo = req.file.mimetype.startsWith('video/') ||
            VIDEO_EXTENSIONS.has(path.extname(req.file.originalname).toLowerCase());

        let fileUrl = null;
        let cloudinaryPublicId = null;

        try {
            const cloudResult = await uploadBuffer(req.file.buffer, {
                folder: `crickbuddy/${type}`,
                resource_type: isVideo ? 'video' : 'image',
            });
            fileUrl = cloudResult.url;
            cloudinaryPublicId = cloudResult.publicId;
            console.log(`✅ Cloudinary upload success: ${fileUrl}`);
        } catch (cloudErr) {
            console.error('❌ Cloudinary upload failed:', cloudErr.message);
            return res.status(502).json({
                success: false,
                message: `Cloud storage upload failed: ${cloudErr.message}. Check CLOUDINARY env vars.`
            });
        }

        const ext = path.extname(req.file.originalname) || (isVideo ? '.mp4' : '.jpg');
        const uniqueFilename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;

        const uploadDoc = await prisma.upload.create({
            data: {
                userId: req.user.id,
                type,
                filename: uniqueFilename,
                originalName: req.file.originalname,
                mimeType: req.file.mimetype,
                fileSize: req.file.size,
                fileUrl,             // Real Cloudinary HTTPS URL
                status: 'pending',
                notes: notes || null
            }
        });

        await prisma.user.update({
            where: { id: req.user.id },
            data: { totalUploads: { increment: 1 } }
        });

        // ── Queue AI analysis — pass Cloudinary URL (not buffer) ──────────
        const { enqueueAnalysis } = require('../utils/queue');
        const enqueueResult = await enqueueAnalysis({
            uploadId: uploadDoc.id,
            fileUrl,                        // Cloudinary URL for AI service to download
            fileBuffer: req.file.buffer,    // Buffer still available for direct processing
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
            type,
            userId: req.user.id
        });

        if (!enqueueResult) {
            throw new Error('Analysis queue did not accept the job');
        }

        res.status(201).json({
            success: true,
            message: 'File uploaded to cloud storage. Analysis queued.',
            upload: uploadDoc
        });
    } catch (err) {
        console.error('❌ Upload route error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── GET /api/uploads — List user's uploads ───────────────────────────────────
router.get('/', protect, async (req, res) => {
    try {
        const uploads = await prisma.upload.findMany({
            where: { userId: req.user.id },
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        res.json({ success: true, uploads });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── GET /api/uploads/:id — Get single upload with status ─────────────────────
router.get('/:id', protect, async (req, res) => {
    try {
        const uploadDoc = await prisma.upload.findFirst({
            where: { id: req.params.id, userId: req.user.id }
        });
        if (!uploadDoc) return res.status(404).json({ success: false, message: 'Upload not found' });
        res.json({ success: true, upload: uploadDoc });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── POST /api/uploads/:id/retry — Retry analysis using Cloudinary URL ────────
router.post('/:id/retry', protect, async (req, res) => {
    try {
        const uploadDoc = await prisma.upload.findFirst({
            where: { id: req.params.id, userId: req.user.id }
        });

        if (!uploadDoc) {
            return res.status(404).json({ success: false, message: 'Upload not found' });
        }

        if (!uploadDoc.fileUrl || !uploadDoc.fileUrl.startsWith('https://')) {
            return res.status(400).json({
                success: false,
                message: 'No cloud URL available for this upload. Please re-upload the file.'
            });
        }

        // Reset status to pending before retry
        await prisma.upload.update({
            where: { id: uploadDoc.id },
            data: { status: 'pending', processingProgress: 0, errorMessage: null }
        });

        const { enqueueAnalysis } = require('../utils/queue');
        await enqueueAnalysis({
            uploadId: uploadDoc.id,
            fileUrl: uploadDoc.fileUrl,   // Download from Cloudinary on retry
            fileName: uploadDoc.originalName,
            mimeType: uploadDoc.mimeType,
            type: uploadDoc.type,
            userId: req.user.id
        });

        return res.json({
            success: true,
            message: 'Analysis retry queued using stored cloud file.'
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
