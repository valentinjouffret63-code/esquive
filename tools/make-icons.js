// Génère icons/icon-180.png et icons/icon-512.png sans dépendance (node tools/make-icons.js).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const SS = 3; // suréchantillonnage pour l'anticrénelage
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
        r += c[0]; g += c[1]; b += c[2];
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r / (SS * SS); raw[o + 1] = g / (SS * SS); raw[o + 2] = b / (SS * SS);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const TOP = hex('#0b1030'), BOT = hex('#2a2560'), GROUND = hex('#141233'), EDGE = hex('#7a6cff');
const BALL = hex('#ff5d73'), BALL_DARK = hex('#8c3340'), WHITE = [255, 255, 255], BODY = hex('#f6f2e8'), INK = hex('#1d1730');

function pixel(u, v) {
  const gy = 0.74;
  let c = v < gy ? mix(TOP, BOT, v / gy) : GROUND;
  if (v >= gy && v < gy + 0.022) c = EDGE;
  // balle
  const bx = 0.62, by = 0.36, br = 0.2;
  const db = Math.hypot(u - bx, v - by);
  if (db < br + 0.06) c = mix(c, BALL, 0.35 * (1 - (db - br) / 0.06) * (db > br ? 1 : 0));
  if (db < br) {
    const hl = Math.hypot(u - (bx - br * 0.35), v - (by - br * 0.35)) / (br * 1.3);
    c = hl < 0.15 ? mix(WHITE, BALL, hl / 0.15) : mix(BALL, BALL_DARK, Math.min(1, (hl - 0.15) / 0.85));
    const band = Math.abs((v - by) - 0.18 * Math.sin((u - bx) * 3)) ;
    if (Math.abs(((u - bx) / (br * 1.05)) ** 2 + ((v - by) / (br * 0.32)) ** 2 - 1) < 0.18) c = mix(c, WHITE, 0.35);
    void band;
  }
  // perso
  const px = 0.32, py = gy - 0.13, pr = 0.1;
  const dp = Math.hypot(u - px, v - py);
  if (dp < pr) c = mix(WHITE, BODY, dp / pr);
  const eye = (ex) => ((u - ex) / 0.016) ** 2 + ((v - (py - 0.01)) / 0.024) ** 2 < 1;
  if (eye(px + 0.0) || eye(px + 0.06)) c = INK;
  // antenne
  if (Math.abs(u - (px + 0.01 - (v - (py - pr)) * 0.3)) < 0.008 && v < py - pr + 0.01 && v > py - pr - 0.08) c = BODY;
  if (Math.hypot(u - (px + 0.035), v - (py - pr - 0.09)) < 0.022) c = EDGE;
  // pieds
  if (((u - (px - 0.04)) / 0.035) ** 2 + ((v - (gy - 0.015)) / 0.02) ** 2 < 1) c = INK;
  if (((u - (px + 0.045)) / 0.035) ** 2 + ((v - (gy - 0.015)) / 0.02) ** 2 < 1) c = INK;
  return c;
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const s of [180, 512]) fs.writeFileSync(path.join(out, `icon-${s}.png`), png(s, pixel));
console.log('icônes générées dans', out);
