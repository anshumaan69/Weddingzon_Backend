const sharp = require('sharp');

/**
 * Compresses an image buffer using Sharp.
 * Resizes to max 1080x1080 (inside), converts to WebP, quality 80.
 * @param {Buffer} buffer - The image buffer
 * @returns {Promise<Buffer>} - The compressed image buffer
 */
const compressImage = async (buffer) => {
    return await sharp(buffer)
        .rotate() // auto-fix orientation
        .resize({
            width: 1080,
            height: 1080,
            fit: 'inside',
            withoutEnlargement: true
        })
        .toFormat('webp', {
            quality: 80,           // sweet spot
            effort: 4              // balance speed/size
        })
        .toBuffer();
};

module.exports = { compressImage };
