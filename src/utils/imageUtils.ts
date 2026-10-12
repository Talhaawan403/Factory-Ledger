/**
 * Utility functions for client-side image compression and encoding.
 * Inspired by Android's DataExchangeUtils image processing in Day-2-Day-Kotlin-Final.
 */

export interface ImageProcessOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  preferPng?: boolean;
}

/**
 * Compresses and encodes an image File to a lightweight Base64 Data URL.
 * Resizes dimensions to stay within maxWidth and maxHeight (default: 400px)
 * ensuring smooth performance and minimal localStorage footprint.
 */
export async function processImageFile(
  file: File,
  options: ImageProcessOptions = {}
): Promise<string> {
  const {
    maxWidth = 400,
    maxHeight = 400,
    quality = 0.82,
    preferPng = false
  } = options;

  if (!file.type.startsWith('image/')) {
    throw new Error('Please select a valid image file (PNG, JPEG, WebP).');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('Failed to read selected image file.'));

    reader.onload = () => {
      const img = new Image();

      img.onerror = () => reject(new Error('Failed to decode image data.'));

      img.onload = () => {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (width === 0 || height === 0) {
          reject(new Error('Invalid image dimensions.'));
          return;
        }

        // Calculate proportional scale
        const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
        const targetWidth = Math.round(width * ratio);
        const targetHeight = Math.round(height * ratio);

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context unavailable.'));
          return;
        }

        // Use high quality image smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const isPng = preferPng || file.type === 'image/png';
        if (!isPng) {
          // Fill crisp white background for JPEGs
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, targetWidth, targetHeight);
        }

        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        const mimeType = isPng ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(mimeType, quality);
        resolve(dataUrl);
      };

      img.src = reader.result as string;
    };

    reader.readAsDataURL(file);
  });
}
