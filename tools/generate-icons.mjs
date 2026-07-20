/**
 * Generates the PWA icon set. Run: `npm run icons`
 *
 * Writes real PNGs with zero dependencies — node's zlib plus a minimal PNG
 * encoder. Keeping this as a script rather than committing opaque binaries
 * means the icons can be regenerated or restyled without a design tool.
 *
 * The mark is a location pin (circle + tapered point) in emerald on slate,
 * matching the dashboard's accent.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const SLATE = [15, 23, 42, 255];     // #0f172a — matches theme-color
const EMERALD = [52, 211, 153, 255]; // #34d399 — matches the Open Now accent

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** @param {(x:number,y:number)=>number[]} shade RGBA per pixel */
function encodePng(size, shade) {
  // Each scanline is prefixed with filter byte 0 (None).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = shade(x, y);
      raw[offset++] = r; raw[offset++] = g; raw[offset++] = b; raw[offset++] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  // bytes 10-12: compression, filter, interlace — all 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * @param size    pixel dimensions
 * @param inset   fraction of the canvas the mark occupies. Maskable icons need
 *                the mark inside the middle 80% so platform cropping can't
 *                clip it; regular icons can fill more of the tile.
 */
function pinIcon(size, inset) {
  const scale = size * inset;
  const cx = size / 2;
  const headR = scale * 0.3;
  const headY = size / 2 - scale * 0.1;
  const tipY = headY + scale * 0.62;
  const holeR = headR * 0.38;

  return encodePng(size, (x, y) => {
    // Sample the pixel centre for slightly smoother edges.
    const px = x + 0.5, py = y + 0.5;
    const dx = px - cx, dy = py - headY;
    const inHead = dx * dx + dy * dy <= headR * headR;

    // Triangle tapering from the head's width down to the tip.
    const t = (py - headY) / (tipY - headY);
    const halfWidth = headR * (1 - t) * 0.92;
    const inTail = t >= 0 && t <= 1 && Math.abs(dx) <= halfWidth;

    const inHole = dx * dx + dy * dy <= holeR * holeR;

    return (inHead || inTail) && !inHole ? EMERALD : SLATE;
  });
}

mkdirSync(OUT_DIR, { recursive: true });

const icons = [
  ['icon-192.png', 192, 0.78],
  ['icon-512.png', 512, 0.78],
  ['icon-512-maskable.png', 512, 0.58], // mark kept well inside the safe zone
  ['apple-touch-icon.png', 180, 0.78],
];

for (const [name, size, inset] of icons) {
  const png = pinIcon(size, inset);
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`${name.padEnd(24)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
