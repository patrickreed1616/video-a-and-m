#!/usr/bin/env node
// Generates the PWA icons (PNG + SVG) with no dependencies: a dark rounded tile,
// an amber play triangle and a small timeline bar. Run: npm run icons
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(join(out, 'icons'), { recursive: true });

const BG = [0x12, 0x13, 0x16], TILE = [0x1d, 0x20, 0x26], AMBER = [0xe0, 0xa5, 0x26], TEAL = [0x2a, 0x9d, 0x92];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const S = 4; // supersampling
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const [pr, pg, pb, pa] = pixel((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size);
        r += pr * pa; g += pg * pa; b += pb * pa; a += pa;
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? Math.round(r / a) : 0; raw[o + 1] = a ? Math.round(g / a) : 0; raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const inRoundRect = (u, v, x0, y0, x1, y1, r) => {
  if (u < x0 || u > x1 || v < y0 || v > y1) return false;
  const cx = Math.min(Math.max(u, x0 + r), x1 - r), cy = Math.min(Math.max(v, y0 + r), y1 - r);
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
};
const inTri = (u, v, [ax, ay], [bx, by], [cx, cy]) => {
  const s = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = s(u, v, ax, ay, bx, by), d2 = s(u, v, bx, by, cx, cy), d3 = s(u, v, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

// Artwork in a 0..1 box; `k` shrinks it toward the centre (maskable safe zone).
function art(u, v, k) {
  const U = 0.5 + (u - 0.5) / k, V = 0.5 + (v - 0.5) / k;
  if (inTri(U, V, [0.36, 0.24], [0.36, 0.64], [0.7, 0.44])) return AMBER;
  if (inRoundRect(U, V, 0.22, 0.72, 0.56, 0.79, 0.035)) return AMBER;
  if (inRoundRect(U, V, 0.6, 0.72, 0.78, 0.79, 0.035)) return TEAL;
  return null;
}
const standard = (u, v) => {
  if (!inRoundRect(u, v, 0.04, 0.04, 0.96, 0.96, 0.2)) return [0, 0, 0, 0];
  return [...(art(u, v, 1) ?? TILE), 1];
};
const maskable = (u, v) => [...(art(u, v, 0.72) ?? TILE), 1];
const apple = (u, v) => [...(art(u, v, 0.86) ?? TILE), 1];

writeFileSync(join(out, 'icons/icon-192.png'), png(192, standard));
writeFileSync(join(out, 'icons/icon-512.png'), png(512, standard));
writeFileSync(join(out, 'icons/icon-maskable-512.png'), png(512, maskable));
writeFileSync(join(out, 'icons/apple-touch-icon.png'), png(180, apple));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="4" y="4" width="92" height="92" rx="20" fill="#1d2026"/>
  <path d="M36 24 L36 64 L70 44 Z" fill="#e0a526"/>
  <rect x="22" y="72" width="34" height="7" rx="3.5" fill="#e0a526"/>
  <rect x="60" y="72" width="18" height="7" rx="3.5" fill="#2a9d92"/>
</svg>
`;
writeFileSync(join(out, 'icons/icon.svg'), svg);
writeFileSync(join(out, 'favicon.svg'), svg);
console.log('icons written to', join(out, 'icons'));
void BG;
