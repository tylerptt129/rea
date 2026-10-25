import { inflateSync } from 'node:zlib';
import jpeg from 'jpeg-js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1;
  return crc >>> 0;
});
const crc32 = data => {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
};
function invalid(reason) {
  return Object.assign(new Error(`Invalid weather image: ${reason}`), { retryable: false });
}
function dimensions(width, height, { maxDimension = 2048, maxPixels = 4 * 1024 * 1024, width: requiredWidth, height: requiredHeight } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > maxDimension || height > maxDimension || width * height > maxPixels)
    throw invalid('image dimensions exceed the supported resource limits');
  if ((requiredWidth !== undefined && width !== requiredWidth) || (requiredHeight !== undefined && height !== requiredHeight))
    throw invalid('image dimensions do not match the requested product');
}
function pngImage(data, limits, nativeIndexed = false) {
  if (data.length < 45 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) throw invalid('PNG signature/header is missing');
  let offset = 8, header, palette, ended = false, imageEnded = false;
  const compressed = [];
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    if (length > data.length - offset - 12) throw invalid('PNG chunk is truncated');
    const nameBytes = data.subarray(offset + 4, offset + 8);
    const name = nameBytes.toString('ascii');
    if (!/^[A-Za-z]{4}$/.test(name)) throw invalid('PNG chunk type is malformed');
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (crc32(data.subarray(offset + 4, offset + 8 + length)) !== data.readUInt32BE(offset + 8 + length)) throw invalid(`PNG ${name} checksum mismatch`);
    if (!header && name !== 'IHDR') throw invalid('PNG must begin with IHDR');
    if (name === 'IHDR') {
      if (header || length !== 13) throw invalid('PNG header is malformed or duplicated');
      const width = body.readUInt32BE(0), height = body.readUInt32BE(4), depth = body[8], color = body[9];
      dimensions(width, height, limits);
      const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }[color];
      if (!channels || !depths.includes(depth) || body[10] !== 0 || body[11] !== 0 || ![0, 1].includes(body[12])) throw invalid('PNG pixel encoding is unsupported or invalid');
      if (nativeIndexed && (depth !== 8 || color !== 3 || body[12] !== 0)) throw invalid('native radar requires a non-interlaced8-bit indexed PNG; RGB/rendered placeholders are not quantitative data');
      header = { width, height, depth, color, channels, interlace: body[12] };
    } else if (name === 'PLTE') {
      if (palette || compressed.length || !length || length % 3 || length > 768 || [0, 4].includes(header.color)) throw invalid('PNG palette is invalid');
      palette = body;
    } else if (name === 'IDAT') {
      if (imageEnded || header.color === 3 && !palette) throw invalid('PNG image/palette chunk order is invalid');
      compressed.push(body);
    } else if (name === 'IEND') {
      if (length || !compressed.length) throw invalid('PNG terminator or image data is missing');
      ended = true;
      offset += length + 12;
      break;
    } else {
      if (compressed.length) imageEnded = true;
      if (name[0] === name[0].toUpperCase()) throw invalid('PNG contains an unsupported critical chunk');
    }
    offset += length + 12;
  }
  if (!ended || offset !== data.length) throw invalid('PNG is truncated or has trailing bytes');
  const passes = header.interlace === 0
    ? [[0, 0, 1, 1]]
    : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  const rows = [];
  let decodedBytes = 0;
  for (const [x, y, dx, dy] of passes) {
    const width = Math.max(0, Math.ceil((header.width - x) / dx)), height = Math.max(0, Math.ceil((header.height - y) / dy));
    if (!width || !height) continue;
    const rowBytes = Math.ceil(width * header.channels * header.depth / 8);
    rows.push({ rowBytes, height }); decodedBytes += (rowBytes + 1) * height;
  }
  if (limits.maxInflatedBytes !== undefined && decodedBytes > limits.maxInflatedBytes) throw invalid('native raster decompression exceeds its resource limit');
  let decoded;
  const input = Buffer.concat(compressed);
  try {
    const result = inflateSync(input, { maxOutputLength: decodedBytes + 1, info: true });
    if (result.engine.bytesWritten !== input.length) throw invalid('PNG has trailing compressed image data');
    decoded = result.buffer;
  } catch (error) { if (error.retryable === false) throw error; throw invalid('PNG image compression is invalid or truncated'); }
  if (decoded.length !== decodedBytes) throw invalid('PNG decompressed image geometry is invalid');
  let row = 0;
  for (const pass of rows) for (let y = 0; y < pass.height; y++) {
    if (decoded[row] > 4) throw invalid('PNG scanline filter is invalid');
    row += pass.rowBytes + 1;
  }
  if (nativeIndexed) {
    const stride = header.width + 1;
    const paeth = (left, up, upperLeft) => {
      const prediction = left + up - upperLeft;
      const dl = Math.abs(prediction - left), du = Math.abs(prediction - up), dc = Math.abs(prediction - upperLeft);
      return dl <= du && dl <= dc ? left : du <= dc ? up : upperLeft;
    };
    // Reconstruct original palette indices in-place. Keep filter bytes as row
    // separators, avoiding a second full66MP output allocation.
    for (let y = 0; y < header.height; y++) {
      const start = y * stride + 1, filter = decoded[start - 1];
      for (let x = 0; x < header.width; x++) {
        const i = start + x, left = x ? decoded[i - 1] : 0, up = y ? decoded[i - stride] : 0, upperLeft = x && y ? decoded[i - stride - 1] : 0;
        const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upperLeft);
        decoded[i] = (decoded[i] + predictor) & 255;
        if (decoded[i] >= palette.length / 3) throw invalid('native PNG references an undefined palette index');
      }
      decoded[start - 1] = 0;
    }
    return { format: 'png', width: header.width, height: header.height, stride, scanlines: decoded };
  }
  return { format: 'png', width: header.width, height: header.height };
}
function jpegImage(data, limits) {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8 || data.at(-2) !== 0xff || data.at(-1) !== 0xd9) throw invalid('JPEG is truncated or lacks its marker framing');
  // Read dimensions before entropy decoding, so an advertised huge image never
  // allocates a full-resolution buffer merely to discover it exceeds limits.
  let offset = 2, size;
  while (offset < data.length - 2) {
    if (data[offset++] !== 0xff) throw invalid('JPEG segment marker is malformed');
    while (data[offset] === 0xff) offset++;
    const marker = data[offset++];
    if (marker === 0xda) break;
    if (marker === 0xd9 || marker === 0 || marker === 0xd8 || marker >= 0xd0 && marker <= 0xd7) throw invalid('JPEG segment order is invalid');
    if (offset + 2 > data.length) throw invalid('JPEG segment is truncated');
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) throw invalid('JPEG segment is truncated');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (size || length < 8 || data[offset + 2] !== 8) throw invalid('JPEG frame encoding is unsupported or malformed');
      size = { height: data.readUInt16BE(offset + 3), width: data.readUInt16BE(offset + 5) };
      dimensions(size.width, size.height, limits);
    }
    offset += length;
  }
  if (!size) throw invalid('JPEG lacks supported frame dimensions');
  try {
    const decoded = jpeg.decode(data, { useTArray: true, tolerantDecoding: false, formatAsRGBA: true, maxResolutionInMP: (limits.maxPixels ?? 4 * 1024 * 1024) / 1e6, maxMemoryUsageInMB: 96 });
    if (decoded.width !== size.width || decoded.height !== size.height || decoded.data.length !== size.width * size.height * 4) throw invalid('JPEG decoded geometry is invalid');
  } catch (error) { if (error.retryable === false) throw error; throw invalid('JPEG image data is invalid or truncated'); }
  return { format: 'jpeg', ...size };
}

/** Admit only bounded, structurally intact, decodable provider imagery. */
export function validateImage(input, contentType, limits = {}) {
  const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!data.length || data.length > (limits.maxBytes ?? 2 * 1024 * 1024)) throw invalid('image exceeds the accepted byte limit or is empty');
  const type = String(contentType).split(';')[0].trim().toLowerCase();
  if (type === 'image/png') return pngImage(data, limits);
  if (type === 'image/jpeg') return jpegImage(data, limits);
  throw invalid('source image format is not supported (PNG/JPEG required)');
}


/** Worker-only native index decode; never call this large-raster path on the UI/main thread. */
export function decodeNativeIndexedPng(input, limits = {}) {
  const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!data.length || data.length > (limits.maxBytes ?? 8 * 1024 * 1024)) throw invalid('native radar image exceeds the compressed byte limit');
  return pngImage(data, { maxDimension: 14_000, maxPixels: 70_000_000, maxInflatedBytes: 70 * 1024 * 1024, ...limits }, true);
}
