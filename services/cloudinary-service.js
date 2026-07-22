// Cloudinary Image Service
// Handles image upload, optimization, and URL generation

let cloudinary = null;

function getCloudinary() {
  if (cloudinary) return cloudinary;
  
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  
  if (!cloudName || !apiKey || !apiSecret) {
    console.warn('Cloudinary not configured — falling back to base64 storage');
    return null;
  }
  
  try {
    const cloudinaryLib = require('cloudinary').v2;
    cloudinaryLib.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret
    });
    cloudinary = cloudinaryLib;
    return cloudinary;
  } catch (err) {
    console.error('Cloudinary init error:', err.message);
    return null;
  }
}

/**
 * Upload image buffer to Cloudinary
 * @param {Buffer} buffer - Image buffer
 * @param {Object} options - Upload options
 * @returns {Promise<Object>} - { url, public_id, width, height, format }
 */
async function uploadImage(buffer, options = {}) {
  const cld = getCloudinary();
  if (!cld) return null;
  
  return new Promise((resolve, reject) => {
    const uploadStream = cld.uploader.upload_stream(
      {
        folder: options.folder || 'awtar-news',
        resource_type: 'image',
        format: 'auto',
        quality: 'auto',
        fetch_format: 'auto',
        transformation: [
          { width: 1200, height: 800, crop: 'limit' },
          { quality: 'auto' }
        ],
        ...options
      },
      (error, result) => {
        if (error) reject(error);
        else resolve({
          url: result.secure_url,
          public_id: result.public_id,
          width: result.width,
          height: result.height,
          format: result.format,
          bytes: result.bytes
        });
      }
    );
    uploadStream.end(buffer);
  });
}

/**
 * Generate optimized image URL with transformations
 * @param {string} url - Original URL or Cloudinary public_id
 * @param {Object} opts - Transformation options
 * @returns {string} - Optimized URL
 */
function optimizeUrl(url, opts = {}) {
  const cld = getCloudinary();
  if (!cld || !url) return url;
  
  // If it's a Cloudinary URL, add transformations
  if (url.includes('cloudinary.com')) {
    const parts = url.split('/upload/');
    if (parts.length === 2) {
      const transformations = [];
      if (opts.width) transformations.push(`w_${opts.width}`);
      if (opts.height) transformations.push(`h_${opts.height}`);
      if (opts.crop) transformations.push(`c_${opts.crop}`);
      transformations.push('q_auto', 'f_auto');
      return `${parts[0]}/upload/${transformations.join(',')}/${parts[1]}`;
    }
  }
  
  return url;
}

/**
 * Delete image from Cloudinary
 * @param {string} publicId - Cloudinary public_id
 */
async function deleteImage(publicId) {
  const cld = getCloudinary();
  if (!cld || !publicId) return;
  
  try {
    await cld.uploader.destroy(publicId);
  } catch (err) {
    console.error('Cloudinary delete error:', err.message);
  }
}

/**
 * Check if Cloudinary is configured
 */
function isConfigured() {
  return !!getCloudinary();
}

module.exports = {
  uploadImage,
  optimizeUrl,
  deleteImage,
  isConfigured,
  getCloudinary
};
