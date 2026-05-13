const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { cloudinary } = require('./cloudinary');
const path = require('path');

const storage = new CloudinaryStorage({
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
    limits: { fileSize: 300 * 1024 * 1024 } // 300MB
});

module.exports = upload;
