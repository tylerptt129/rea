import { parentPort } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { decodeNativeIndexedPng } from './images.mjs';

let raster;
parentPort.on('message', ({ id, operation, data, contentType, token, column, row }) => {
  try {
    if (operation === 'admit') {
      if (String(contentType).split(';')[0].trim().toLowerCase() !== 'image/png') throw new Error('The native N0Q source must return an indexed PNG, not rendered RGB or another format.');
      const bytes = Buffer.from(data);
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (raster?.token !== digest) {
        const decoded = decodeNativeIndexedPng(bytes);
        raster = { ...decoded, token: digest };
      }
      parentPort.postMessage({ id, value: { token: raster.token, width: raster.width, height: raster.height, bytes: raster.scanlines.byteLength, mode: 'indexed8' } });
    } else if (operation === 'pixel') {
      if (!raster || raster.token !== token) throw new Error('Native radar raster is no longer loaded; retry the point probe.');
      if (!Number.isInteger(column) || !Number.isInteger(row) || column < 0 || row < 0 || column >= raster.width || row >= raster.height) throw new Error('Native radar pixel is outside source coverage.');
      parentPort.postMessage({ id, value: raster.scanlines[row * raster.stride + 1 + column] });
    } else throw new Error('Unsupported native radar worker operation.');
  } catch (error) {
    parentPort.postMessage({ id, error: { message: error.message, retryable: false } });
  }
});
