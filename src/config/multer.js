const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '..', '..', 'uploads'));
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${uuidv4()}${ext}`);
    }
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
