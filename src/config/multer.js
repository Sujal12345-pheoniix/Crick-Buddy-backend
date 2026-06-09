const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storageMode = process.env.STORAGE_MODE || 'cloudinary';
let storage;

if (storageMode === 'local') {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }
    storage = multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
        }
    });
} else {
    const { CloudinaryStorage } = require('multer-storage-cloudinary');
    const { cloudinary } = require('./cloudinary');
    storage = new CloudinaryStorage({
        cloudinary: cloudinary,
        params: async (req, file) => {
            const isVideo = file.mimetype.startsWith('video/') || /mp4|mov|avi|mkv|webm/.test(path.extname(file.originalname).toLowerCase());
            const type = req.body.type || 'general';
            return {
                folder: `crickbuddy/${type}`,
                resource_type: isVideo ? 'video' : 'image',
                public_id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            };
        },
    });
}

const fileFilter = (req, file, cb) => {
    const allowed = /mp4|mov|avi|mkv|webm|jpg|jpeg|png|gif|webp/;
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    if (allowed.test(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Unsupported file type. Allowed: mp4, mov, avi, mkv, webm, jpg, jpeg, png, gif'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB — matches UI claim
});

module.exports = upload;
