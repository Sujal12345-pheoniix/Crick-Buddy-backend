const { v2: cloudinary } = require('cloudinary');

// Configure Cloudinary from env variables.
// Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in Render.
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
});

/**
 * Upload a file Buffer directly to Cloudinary.
 * Returns the secure_url and public_id.
 *
 * @param {Buffer} buffer  - File bytes
 * @param {object} opts    - Options: { folder, resource_type, public_id }
 * @returns {Promise<{ url: string, publicId: string }>}
 */
function uploadBuffer(buffer, opts = {}) {
    return new Promise((resolve, reject) => {
        const uploadOpts = {
            folder: opts.folder || 'crickbuddy',
            resource_type: opts.resource_type || 'auto', // auto detects image/video
            public_id: opts.public_id || undefined,
            overwrite: true,
        };

        const stream = cloudinary.uploader.upload_stream(uploadOpts, (error, result) => {
            if (error) return reject(error);
            resolve({ url: result.secure_url, publicId: result.public_id });
        });

        stream.end(buffer);
    });
}

/**
 * Delete a file from Cloudinary by public_id.
 * @param {string} publicId
 * @param {'image'|'video'|'raw'} resourceType
 */
async function deleteFile(publicId, resourceType = 'video') {
    try {
        await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    } catch (err) {
        console.warn(`⚠️  Cloudinary delete skipped for ${publicId}: ${err.message}`);
    }
}

module.exports = { cloudinary, uploadBuffer, deleteFile };
