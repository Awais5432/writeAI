const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// Signed distance to a rounded rectangle centered at (cx, cy).
function sdRoundRect(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - r;
}

// Distance from point to a line segment.
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function distToPolyline(px, py, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    d = Math.min(d, distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  }
  return d;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function createIcon(size) {
  const SS = 4; // supersampling factor for smooth anti-aliasing
  const cx = size / 2;
  const cy = size / 2;
  const half = size / 2;
  const radius = size * 0.24;

  // Brand gradient (top -> bottom)
  const top = [124, 108, 255];   // #7C6CFF
  const bottom = [88, 80, 224];  // #5850E0

  // "W" letterform as a polyline, in normalized coords.
  const norm = [
    [0.17, 0.31],
    [0.35, 0.71],
    [0.5, 0.45],
    [0.65, 0.71],
    [0.83, 0.31]
  ];
  const wPts = norm.map(([nx, ny]) => [nx * size, ny * size]);
  const halfStroke = Math.max(1.1, size * 0.075);

  // Sparkle accent (top-right)
  const sparkle = [size * 0.74, size * 0.26];
  const sparkleR = Math.max(0.8, size * 0.055);

  const raw = Buffer.alloc((1 + size * 4) * size);

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      let covered = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      const total = SS * SS;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;

          const sd = sdRoundRect(fx, fy, cx, cy, half, half, radius);
          if (sd >= 0) continue; // outside tile -> transparent

          covered++;

          // base gradient color
          const t = fy / size;
          let r = lerp(top[0], bottom[0], t);
          let g = lerp(top[1], bottom[1], t);
          let b = lerp(top[2], bottom[2], t);

          // subtle top-left sheen
          const sheen = Math.max(0, 1 - Math.hypot(fx - size * 0.3, fy - size * 0.28) / (size * 0.7));
          r = lerp(r, 255, sheen * 0.10);
          g = lerp(g, 255, sheen * 0.10);
          b = lerp(b, 255, sheen * 0.10);

          // white "W"
          const dw = distToPolyline(fx, fy, wPts);
          if (dw <= halfStroke) {
            r = 255; g = 255; b = 255;
          }

          // sparkle dot
          const dsp = Math.hypot(fx - sparkle[0], fy - sparkle[1]);
          if (dsp <= sparkleR) {
            r = 255; g = 255; b = 255;
          }

          rSum += r; gSum += g; bSum += b;
        }
      }

      const idx = rowStart + 1 + x * 4;
      const alpha = Math.round((covered / total) * 255);
      if (covered > 0) {
        raw[idx] = Math.round(rSum / covered);
        raw[idx + 1] = Math.round(gSum / covered);
        raw[idx + 2] = Math.round(bSum / covered);
        raw[idx + 3] = alpha;
      } else {
        raw[idx] = 0; raw[idx + 1] = 0; raw[idx + 2] = 0; raw[idx + 3] = 0;
      }
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const iconsDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

[16, 32, 48, 128].forEach((size) => {
  const file = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(file, createIcon(size));
  console.log(`Created ${file}`);
});
