const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const prisma = require('../utils/prisma');
const upload = require('../config/multer');
const { protect } = require('../middleware/auth');

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

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// POST /api/uploads — Upload a file and trigger AI analysis
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
            try {
                fs.unlinkSync(req.file.path);
            } catch (_) {
                // ignore cleanup failures for invalid files
            }
            return res.status(400).json({
                success: false,
                message: `Invalid file for ${type} analysis. Expected ${mediaCheck.expected}.`
            });
        }

        const fileUrl = `/uploads/${req.file.filename}`;

        const uploadDoc = await prisma.upload.create({
            data: {
                userId: req.user.id,
                type,
                filename: req.file.filename,
                originalName: req.file.originalname,
                mimeType: req.file.mimetype,
                fileSize: req.file.size,
                fileUrl,
                status: 'pending',
                notes: notes || null
            }
        });

        await prisma.user.update({
            where: { id: req.user.id },
            data: { totalUploads: { increment: 1 } }
        });

        // Trigger AI analysis asynchronously via BullMQ Redis Queue (falls back to direct if Redis is down)
        const { enqueueAnalysis } = require('../utils/queue');
        const enqueueResult = await enqueueAnalysis({
            uploadId: uploadDoc.id,
            filePath: req.file.path,
            type,
            userId: req.user.id
        });

        if (!enqueueResult) {
            throw new Error('Analysis queue did not accept the job');
        }

        res.status(201).json({
            success: true,
            message: 'File uploaded successfully. Analysis queued.',
            upload: uploadDoc
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/uploads — List user's uploads
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

// GET /api/uploads/:id — Get single upload with status
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

// POST /api/uploads/:id/retry — Retry analysis for an existing upload
router.post('/:id/retry', protect, async (req, res) => {
    try {
        const uploadDoc = await prisma.upload.findFirst({
            where: { id: req.params.id, userId: req.user.id }
        });

        if (!uploadDoc) {
            return res.status(404).json({ success: false, message: 'Upload not found' });
        }

        const filePath = path.join(uploadsDir, uploadDoc.filename);
        if (!fs.existsSync(filePath)) {
            return res.status(400).json({
                success: false,
                message: 'Upload file is missing on server. Re-upload is required.'
            });
        }

        await prisma.upload.update({
            where: { id: uploadDoc.id },
            data: {
                status: 'pending',
                processingProgress: 0,
                errorMessage: null
            }
        });

        const { enqueueAnalysis } = require('../utils/queue');
        const enqueueResult = await enqueueAnalysis({
            uploadId: uploadDoc.id,
            filePath,
            type: uploadDoc.type,
            userId: req.user.id
        });

        if (!enqueueResult) {
            throw new Error('Analysis retry queue did not accept the job');
        }

        return res.json({
            success: true,
            message: 'Analysis retry started',
            upload: {
                ...uploadDoc,
                status: 'pending',
                processingProgress: 0,
                errorMessage: null
            }
        });
    } catch (err) {
        await prisma.upload.update({
            where: { id: req.params.id },
            data: { status: 'failed', errorMessage: err.message }
        }).catch(() => {});

        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
