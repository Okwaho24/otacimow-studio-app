// Otâcimow license + AcerbE seal reference implementation (Node, zero dependencies).
// Format spec: docs/SEAL_SPEC.md. Must stay byte-compatible with
// android/app/src/main/java/com/otacimow/seal/{License,Mp4Seal}.kt.
import crypto from 'node:crypto';
import fs from 'node:fs';

export const LICENSE_PREFIX = 'OTC1';
export const SKU = 'otacimow';
export const SEAL_MAGIC = 'OTCSEAL1';
export const MAX_TOKEN_CHARS = 2048;
const MAX_SEAL_PAYLOAD = 4096;
const SKEW_MS = 24 * 3600 * 1000;
const KEY_RE = /^[a-z][a-z0-9_]{0,15}$/;
const VAL_RE = /^[A-Za-z0-9._:+-]{1,2048}$/;
const TID_RE = /^[A-Za-z0-9._-]{4,64}$/;
const HEX64 = /^[0-9a-f]{64}$/;

const b64u = (b) => Buffer.from(b).toString('base64url');
const iso = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function parseKv(buf) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch { return null; }
  if (!text) return null;
  const out = new Map();
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i <= 0) return null;
    const k = line.slice(0, i), v = line.slice(i + 1);
    if (!KEY_RE.test(k) || !VAL_RE.test(v) || out.has(k)) return null;
    out.set(k, v);
  }
  return out;
}

export function issueToken(privatePem, { tid, iat = new Date(), exp = null }) {
  if (!TID_RE.test(tid)) throw new Error('tid must match [A-Za-z0-9._-]{4,64}');
  const lines = ['v=1', `tid=${tid}`, `sku=${SKU}`, `iat=${iso(iat)}`];
  if (exp) lines.push(`exp=${iso(exp)}`);
  const payload = Buffer.from(lines.join('\n'), 'utf8');
  const sig = crypto.sign('sha256', payload, { key: privatePem, dsaEncoding: 'der' });
  return `${LICENSE_PREFIX}.${b64u(payload)}.${b64u(sig)}`;
}

/** Signature, version and SKU only (no time checks). */
export function parseSignedToken(publicPem, token) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_CHARS) return { ok: false, reason: 'MALFORMED' };
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) return { ok: false, reason: 'MALFORMED' };
  let payload, sig;
  try {
    payload = Buffer.from(parts[1], 'base64url');
    sig = Buffer.from(parts[2], 'base64url');
  } catch { return { ok: false, reason: 'MALFORMED' }; }
  let good = false;
  try {
    good = crypto.verify('sha256', payload, { key: publicPem, dsaEncoding: 'der' }, sig);
  } catch { good = false; }
  if (!good) return { ok: false, reason: 'BAD_SIGNATURE' };
  const kv = parseKv(payload);
  if (!kv) return { ok: false, reason: 'MALFORMED' };
  if (kv.get('v') !== '1') return { ok: false, reason: 'UNSUPPORTED_VERSION' };
  if (kv.get('sku') !== SKU) return { ok: false, reason: 'WRONG_SKU' };
  const tid = kv.get('tid');
  const iat = Date.parse(kv.get('iat') ?? '');
  const exp = kv.has('exp') ? Date.parse(kv.get('exp')) : null;
  if (!tid || Number.isNaN(iat) || (exp !== null && Number.isNaN(exp))) return { ok: false, reason: 'MALFORMED' };
  return { ok: true, license: { tid, iat, exp, token: token.trim() } };
}

export function verifyToken(publicPem, token, now = new Date()) {
  const p = parseSignedToken(publicPem, token);
  if (!p.ok) return p;
  const t = +now;
  if (p.license.iat > t + SKEW_MS) return { ok: false, reason: 'NOT_YET_VALID' };
  if (p.license.exp !== null && t > p.license.exp) return { ok: false, reason: 'EXPIRED' };
  return p;
}

// ---- ISO-BMFF seal ------------------------------------------------------------------

function walk(fd, len) {
  const boxes = [];
  const hdr = Buffer.alloc(16);
  let pos = 0;
  while (pos < len) {
    if (len - pos < 8) throw Object.assign(new Error('truncated'), { code: boxes.length ? 'MALFORMED_MP4' : 'NOT_MP4' });
    fs.readSync(fd, hdr, 0, 8, pos);
    const type = hdr.toString('latin1', 4, 8);
    if (boxes.length === 0 && type !== 'ftyp') throw Object.assign(new Error('not mp4'), { code: 'NOT_MP4' });
    let size = BigInt(hdr.readUInt32BE(0));
    let headerLen = 8, toEof = false;
    if (size === 1n) {
      if (len - pos < 16) throw Object.assign(new Error('truncated'), { code: 'MALFORMED_MP4' });
      fs.readSync(fd, hdr, 8, 8, pos + 8);
      size = hdr.readBigUInt64BE(8);
      headerLen = 16;
    } else if (size === 0n) { size = BigInt(len - pos); toEof = true; }
    if (size < BigInt(headerLen) || size > BigInt(len - pos)) throw Object.assign(new Error('bad size'), { code: 'MALFORMED_MP4' });
    boxes.push({ start: pos, size: Number(size), type, headerLen, toEof });
    pos += Number(size);
  }
  if (!boxes.length) throw Object.assign(new Error('empty'), { code: 'NOT_MP4' });
  return boxes;
}

function isSeal(fd, b) {
  if (b.type !== 'free' || b.size - b.headerLen < 12) return false;
  const m = Buffer.alloc(8);
  fs.readSync(fd, m, 0, 8, b.start + b.headerLen);
  return m.toString('ascii') === SEAL_MAGIC;
}

function sha256Range(fd, length) {
  const h = crypto.createHash('sha256');
  const buf = Buffer.alloc(64 * 1024);
  let pos = 0;
  while (pos < length) {
    const n = fs.readSync(fd, buf, 0, Math.min(buf.length, length - pos), pos);
    if (n <= 0) throw new Error('unexpected EOF');
    h.update(buf.subarray(0, n));
    pos += n;
  }
  return h.digest();
}

/** Appends a seal in place. */
export function sealFile(path, license, now = new Date()) {
  const fd = fs.openSync(path, 'r+');
  try {
    const len = fs.fstatSync(fd).size;
    const boxes = walk(fd, len);
    if (boxes.some((b) => isSeal(fd, b))) throw new Error('ALREADY_SEALED');
    if (boxes[boxes.length - 1].toEof) throw new Error('UNSUPPORTED_LAYOUT');
    const hash = sha256Range(fd, len).toString('hex');
    const ts = iso(now);
    const payload = Buffer.from(['v=1', `sha256=${hash}`, `ts=${ts}`, `tok=${license.token}`].join('\n'), 'utf8');
    if (payload.length > MAX_SEAL_PAYLOAD) throw new Error('PAYLOAD_TOO_LARGE');
    const magic = Buffer.from(SEAL_MAGIC, 'ascii');
    const atom = Buffer.alloc(8 + magic.length + 4 + payload.length);
    atom.writeUInt32BE(atom.length, 0);
    atom.write('free', 4, 'ascii');
    magic.copy(atom, 8);
    atom.writeUInt32BE(payload.length, 8 + magic.length);
    payload.copy(atom, 8 + magic.length + 4);
    fs.writeSync(fd, atom, 0, atom.length, len);
    fs.fsyncSync(fd);
    return { sha256: hash, tid: license.tid, ts };
  } finally { fs.closeSync(fd); }
}

export function verifySeal(publicPem, path) {
  const fd = fs.openSync(path, 'r');
  try {
    const len = fs.fstatSync(fd).size;
    let boxes;
    try { boxes = walk(fd, len); } catch (e) {
      return { status: e.code === 'NOT_MP4' ? 'NOT_MP4' : 'MALFORMED_FILE' };
    }
    const seals = boxes.filter((b) => isSeal(fd, b));
    if (!seals.length) return { status: 'NO_SEAL' };
    if (seals.length > 1) return { status: 'MALFORMED_SEAL' };
    const sb = seals[0];
    if (sb !== boxes[boxes.length - 1]) return { status: 'TAMPERED_TRAILING' };
    const bodyLen = sb.size - sb.headerLen;
    if (bodyLen < 12 || bodyLen > 12 + MAX_SEAL_PAYLOAD) return { status: 'MALFORMED_SEAL' };
    const lenBuf = Buffer.alloc(4);
    fs.readSync(fd, lenBuf, 0, 4, sb.start + sb.headerLen + 8);
    const plen = lenBuf.readUInt32BE(0);
    if (plen !== bodyLen - 12) return { status: 'MALFORMED_SEAL' };
    const payload = Buffer.alloc(plen);
    fs.readSync(fd, payload, 0, plen, sb.start + sb.headerLen + 12);
    const kv = parseKv(payload);
    if (!kv) return { status: 'MALFORMED_SEAL' };
    const declared = kv.get('sha256'), tok = kv.get('tok'), ts = Date.parse(kv.get('ts') ?? '');
    if (kv.get('v') !== '1' || !declared || !HEX64.test(declared) || !tok || Number.isNaN(ts)) return { status: 'MALFORMED_SEAL' };
    const p = parseSignedToken(publicPem, tok);
    if (!p.ok) return { status: 'BAD_LICENSE', licenseError: p.reason };
    const { license } = p;
    if (ts < license.iat - SKEW_MS) return { status: 'BAD_LICENSE', tid: license.tid, licenseError: 'NOT_YET_VALID' };
    if (license.exp !== null && ts > license.exp) return { status: 'BAD_LICENSE', tid: license.tid, licenseError: 'EXPIRED' };
    const actual = sha256Range(fd, sb.start);
    const ok = crypto.timingSafeEqual(actual, Buffer.from(declared, 'hex'));
    return { status: ok ? 'VALID' : 'TAMPERED_CONTENT', tid: license.tid, ts: iso(ts), sha256: declared };
  } finally { fs.closeSync(fd); }
}
