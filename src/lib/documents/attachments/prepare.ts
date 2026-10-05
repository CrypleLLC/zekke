import {
  MAX_PREPARED_IMAGE_BYTES,
  MAX_SOURCE_IMAGE_BYTES,
  PREPARED_MAX_WIDTH_PX,
  THUMBNAIL_MAX_WIDTH_PX,
} from './records';

export const PREPARED_MAX_HEIGHT_PX = 8000;
export const IMAGE_QUALITY = 0.9;
export const THUMBNAIL_QUALITY = 0.75;

const ACCEPTED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
]);
const MAY_BE_TRANSPARENT = new Set(['image/png', 'image/webp', 'image/gif', 'image/avif']);

export type ImageRefusal = 'too-large' | 'svg' | 'unsupported' | 'unreadable' | 'too-large-prepared';

export class ImageRefusedError extends Error {
  constructor(readonly reason: ImageRefusal) {
    super(imageRefusalMessage(reason));
    this.name = 'ImageRefusedError';
  }
}

export function imageRefusalMessage(reason: ImageRefusal): string {
  switch (reason) {
    case 'too-large':
      return 'This image is larger than 5 MB.';
    case 'svg':
      return 'SVG images cannot be inserted: an SVG is a document that can carry script.';
    case 'unsupported':
      return 'Only JPEG, PNG, WebP, GIF, AVIF and BMP images can be inserted.';
    case 'unreadable':
      return 'This image could not be read.';
    case 'too-large-prepared':
      return 'This image is still too large after preparing it for the page.';
  }
}

export function normalizedImageType(mime: string): string {
  return mime.toLowerCase().split(';')[0].trim();
}

export function assertInsertableImage(file: { size: number; type: string }): void {
  const type = normalizedImageType(file.type);
  if (type === 'image/svg+xml') {
    throw new ImageRefusedError('svg');
  }
  if (!ACCEPTED_TYPES.has(type)) {
    throw new ImageRefusedError('unsupported');
  }
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new ImageRefusedError('too-large');
  }
}

export function mayBeTransparent(mime: string): boolean {
  return MAY_BE_TRANSPARENT.has(normalizedImageType(mime));
}

export interface Extent {
  width: number;
  height: number;
}

export function fittedExtent(source: Extent, maxWidth: number, maxHeight = Infinity): Extent {
  if (source.width <= 0 || source.height <= 0) {
    return { width: 0, height: 0 };
  }

  const scale = Math.min(1, maxWidth / source.width, maxHeight / source.height);

  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

export function preparedExtent(source: Extent): Extent {
  return fittedExtent(source, PREPARED_MAX_WIDTH_PX, PREPARED_MAX_HEIGHT_PX);
}

export function thumbnailExtentFor(source: Extent): Extent {
  return fittedExtent(source, THUMBNAIL_MAX_WIDTH_PX, THUMBNAIL_MAX_WIDTH_PX * 2);
}

export interface EncodedCandidate {
  mime: string;
  size: number;
}

export function chooseEncoding<T extends EncodedCandidate>(
  candidates: readonly T[],
  transparent: boolean,
): T | undefined {
  const webp = candidates.find((candidate) => candidate.mime === 'image/webp');
  const png = candidates.find((candidate) => candidate.mime === 'image/png');
  const jpeg = candidates.find((candidate) => candidate.mime === 'image/jpeg');

  if (transparent) {
    if (webp !== undefined && png !== undefined) {
      return png.size < webp.size ? png : webp;
    }
    return webp ?? png;
  }

  return webp ?? jpeg ?? png;
}

export interface PreparedPicture {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
}

export interface PreparedImage {
  image: PreparedPicture;
  thumbnail: PreparedPicture;
}

interface DrawingSurface {
  width: number;
  height: number;
  getContext(kind: '2d'): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
}

export async function prepareImage(file: Blob & { type: string }): Promise<PreparedImage> {
  assertInsertableImage(file);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageRefusedError('unreadable');
  }

  try {
    const transparentSource = mayBeTransparent(file.type);
    const image = await renderPicture(bitmap, preparedExtent(bitmap), IMAGE_QUALITY, transparentSource);
    if (image.bytes.length > MAX_PREPARED_IMAGE_BYTES) {
      throw new ImageRefusedError('too-large-prepared');
    }
    const thumbnail = await renderPicture(
      bitmap,
      thumbnailExtentFor(bitmap),
      THUMBNAIL_QUALITY,
      transparentSource,
    );

    return { image, thumbnail };
  } finally {
    bitmap.close();
  }
}

async function renderPicture(
  bitmap: ImageBitmap,
  extent: Extent,
  quality: number,
  transparentSource: boolean,
): Promise<PreparedPicture> {
  if (extent.width === 0) {
    throw new ImageRefusedError('unreadable');
  }

  const surface = createSurface(extent);
  const context = surface.getContext('2d');
  if (context === null) {
    throw new ImageRefusedError('unreadable');
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, extent.width, extent.height);

  const transparent = transparentSource && hasTransparency(context, extent);
  const candidates: (EncodedCandidate & { blob: Blob })[] = [];

  for (const mime of transparent ? ['image/webp', 'image/png'] : ['image/webp', 'image/jpeg']) {
    const blob = await encodeSurface(surface, mime, quality);
    if (blob !== undefined && blob.type === mime) {
      candidates.push({ mime, size: blob.size, blob });
      if (!transparent && mime === 'image/webp') {
        break;
      }
    }
  }

  const chosen = chooseEncoding(candidates, transparent);
  if (chosen === undefined) {
    throw new ImageRefusedError('unreadable');
  }

  return {
    bytes: new Uint8Array(await chosen.blob.arrayBuffer()),
    mime: chosen.mime,
    width: extent.width,
    height: extent.height,
  };
}

function createSurface(extent: Extent): DrawingSurface {
  if (typeof OffscreenCanvas === 'function') {
    return new OffscreenCanvas(extent.width, extent.height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = extent.width;
  canvas.height = extent.height;
  return canvas;
}

async function encodeSurface(surface: DrawingSurface, mime: string, quality: number): Promise<Blob | undefined> {
  try {
    if (typeof OffscreenCanvas === 'function' && surface instanceof OffscreenCanvas) {
      return await surface.convertToBlob({ type: mime, quality });
    }
    return await new Promise<Blob | undefined>((resolve) =>
      (surface as HTMLCanvasElement).toBlob((blob) => resolve(blob ?? undefined), mime, quality),
    );
  } catch {
    return undefined;
  }
}

function hasTransparency(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  extent: Extent,
): boolean {
  const pixels = context.getImageData(0, 0, extent.width, extent.height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 255) {
      return true;
    }
  }
  return false;
}
