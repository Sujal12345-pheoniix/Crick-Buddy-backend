const multer = require('multer');
const path = require('path');

// Use memory storage — production-safe, no filesystem dependency.
// File bytes are held in req.file.buffer and streamed directly to AI service.
const storage = multer.memoryStorage();

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
