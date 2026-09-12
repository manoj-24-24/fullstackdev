// PWA icon generator: teal rounded tile + white </> mark.
// Writes public/icon-512.png, icon-192.png, apple-touch-icon.png (180),
// favicon.png (32), icon-maskable.png (512, safe-zone scaled).
// Pure Node (zlib only), rerun anytime: node make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const distToSeg = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

const roundedRectDist = (px, py, half, r) => {
  const qx = Math.abs(px) - (half - r), qy = Math.abs(py) - (half - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

const S = 512;
// </> geometry in the 512 box; left and right chevrons meet near the center.
const chevrons = [
  [252, 148, 160, 256], [160, 256, 252, 364], // left <
  [260, 148, 352, 256], [352, 256, 260, 364], // right >
];
// Slash drawn as a gentle slanted line through the middle.
const slash = [[282, 130], [230, 382]];
const strokeW = 40;

function tileIcon(size, { maskable = false } = {}) {
  return png(size, (x, y) => {
    const sx = (x + 0.5) * (S / size), sy = (y + 0.5) * (S / size);
    const cx = sx - S / 2, cy = sy - S / 2;
    // Outside the tile (any-purpose icons keep square corners transparent,
    // matching the reference's rounded tile on white).
    if (!maskable) {
      const d = roundedRectDist(cx, cy, S / 2 - 6, 96);
      if (d > 1.5) return [0, 0, 0, 0];
      if (d > -1.5) return [8, 127, 120, Math.round(255 * (1 - (d + 1.5) / 3))]; // AA edge
    }
    // Vertical teal gradient (#0a8f86 -> #056b64).
    const t = sy / S;
    const bg = [Math.round(10 - 5 * t), Math.round(143 - 76 * t), Math.round(134 - 70 * t), 255];
    const scale = maskable ? 0.62 : 0.86; // maskable keeps art in the 80% safe zone
    const u = (sx - S / 2) / scale + S / 2, v = (sy - S / 2) / scale + S / 2;
    for (const [x1, y1, x2, y2] of chevrons) {
      if (distToSeg(u, v, x1, y1, x2, y2) <= strokeW / 2) return [255, 255, 255, 255];
    }
    if (distToSeg(u, v, slash[0][0], slash[0][1], slash[1][0], slash[1][1]) <= strokeW / 2) return [255, 255, 255, 255];
    return bg;
  });
}

mkdirSync('public', { recursive: true });
writeFileSync('public/icon-512.png', tileIcon(512));
writeFileSync('public/icon-192.png', tileIcon(192));
writeFileSync('public/icon-maskable.png', tileIcon(512, { maskable: true }));
writeFileSync('public/apple-touch-icon.png', tileIcon(180));
writeFileSync('public/favicon.png', tileIcon(32));
console.log('icons written: 512, 192, maskable-512, 180, 32');
