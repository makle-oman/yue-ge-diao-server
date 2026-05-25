const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encode(lat: number, lng: number, precision = 8): string {
  if (precision < 1 || precision > 12) {
    throw new Error(`geohash precision must be in [1,12], got ${precision}`);
  }
  let latLo = -90;
  let latHi = 90;
  let lngLo = -180;
  let lngHi = 180;
  let bits = 0;
  let bitCount = 0;
  let even = true;
  let out = '';

  while (out.length < precision) {
    if (even) {
      const mid = (lngLo + lngHi) / 2;
      if (lng >= mid) {
        bits = (bits << 1) | 1;
        lngLo = mid;
      } else {
        bits <<= 1;
        lngHi = mid;
      }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) {
        bits = (bits << 1) | 1;
        latLo = mid;
      } else {
        bits <<= 1;
        latHi = mid;
      }
    }
    even = !even;
    bitCount++;
    if (bitCount === 5) {
      out += BASE32[bits];
      bits = 0;
      bitCount = 0;
    }
  }
  return out;
}

// decode：geohash 串还原出 cell 的 bbox。neighbors 用它拿到 cell 实际边界，
// 再"从 cell 中心 ± cell_width"探邻居，避免输入点在 cell 边缘时探到 2 格外。
export function decode(hash: string): {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
} {
  let latLo = -90;
  let latHi = 90;
  let lngLo = -180;
  let lngHi = 180;
  let even = true;
  for (const ch of hash) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error(`invalid geohash char: ${ch}`);
    for (let bit = 4; bit >= 0; bit--) {
      const b = (idx >> bit) & 1;
      if (even) {
        const mid = (lngLo + lngHi) / 2;
        if (b) lngLo = mid;
        else lngHi = mid;
      } else {
        const mid = (latLo + latHi) / 2;
        if (b) latLo = mid;
        else latHi = mid;
      }
      even = !even;
    }
  }
  return { latMin: latLo, latMax: latHi, lngMin: lngLo, lngMax: lngHi };
}

// 9 格邻居（含自己）。先 encode→decode 得到当前 cell 的精确 bbox，
// 再以 **cell 中心** ± cell_width 探，保证 8 次 encode 命中 8 个真邻居 cell。
export function neighbors(lat: number, lng: number, precision: number): string[] {
  const center = encode(lat, lng, precision);
  const bbox = decode(center);
  const latC = (bbox.latMin + bbox.latMax) / 2;
  const lngC = (bbox.lngMin + bbox.lngMax) / 2;
  const dLat = bbox.latMax - bbox.latMin;
  const dLng = bbox.lngMax - bbox.lngMin;
  const set = new Set<string>();
  for (const dy of [-dLat, 0, dLat]) {
    for (const dx of [-dLng, 0, dLng]) {
      set.add(encode(latC + dy, lngC + dx, precision));
    }
  }
  return [...set];
}

export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 9 格覆盖半径 ≈ cell_smaller_side × 1.5
// 中国常见纬度（~30°-45°）下：
//   p3 ≈ 178km  p4 ≈ 29km  p5 ≈ 5.6km  p6 ≈ 920m  p7 ≈ 176m
// 要让 9 格能盖住查询半径，必须 cell_smaller_side ≥ radius / 1.5。
export function precisionForRadius(radiusM: number): number {
  if (radiusM <= 170) return 7;
  if (radiusM <= 900) return 6;
  if (radiusM <= 5_500) return 5;
  if (radiusM <= 29_000) return 4;
  return 3;
}
