#!/usr/bin/env node
// Self-test for the operator tools. Uses a throwaway keypair in a temp dir; touches no real keys.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { issueToken, verifyToken, sealFile, verifySeal } from './license-lib.mjs';

const VEC = path.resolve('android/app/src/test/resources/vectors');
let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`);
  if (!cond) failed++;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otc-selftest-'));
try {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const now = new Date();

  const tok = issueToken(priv, { tid: 'SELFTEST-1', iat: now });
  const v = verifyToken(pub, tok, now);
  check('issued token verifies', v.ok && v.license.tid === 'SELFTEST-1');

  const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'pem' });
  check('token rejected under a different public key', !verifyToken(other, tok, now).ok);

  const expired = issueToken(priv, { tid: 'SELFTEST-2', iat: new Date(+now - 5 * 864e5), exp: new Date(+now - 2 * 864e5) });
  const ve = verifyToken(pub, expired, now);
  check('expired token rejected', !ve.ok && ve.reason === 'EXPIRED', JSON.stringify(ve));

  const flipped = tok.slice(0, -4) + (tok.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  check('altered token rejected', !verifyToken(pub, flipped, now).ok);

  const src = path.join(VEC, 'sample.mp4');
  const f = path.join(tmp, 'a.mp4');
  fs.copyFileSync(src, f);
  check('unsealed file reports NO_SEAL', verifySeal(pub, f).status === 'NO_SEAL');
  const lic = verifyToken(pub, tok, now).license;
  sealFile(f, { ...lic, token: tok }, now);
  const r = verifySeal(pub, f);
  check('sealed file verifies', r.status === 'VALID' && r.tid === 'SELFTEST-1', JSON.stringify(r));

  let threw = false;
  try { sealFile(f, { ...lic, token: tok }, now); } catch { threw = true; }
  check('double seal refused', threw);

  const t1 = path.join(tmp, 'b.mp4');
  const buf = fs.readFileSync(f);
  buf[200] ^= 0xff;
  fs.writeFileSync(t1, buf);
  check('flipped video byte -> TAMPERED_CONTENT', verifySeal(pub, t1).status === 'TAMPERED_CONTENT');

  const t2 = path.join(tmp, 'c.mp4');
  fs.writeFileSync(t2, Buffer.concat([fs.readFileSync(f), Buffer.from([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65])]));
  check('data appended after seal -> TAMPERED_TRAILING', verifySeal(pub, t2).status === 'TAMPERED_TRAILING');

  const t3 = path.join(tmp, 'd.mp4');
  fs.writeFileSync(t3, fs.readFileSync(f).subarray(0, 100));
  check('truncated file -> MALFORMED_FILE', verifySeal(pub, t3).status === 'MALFORMED_FILE');

  const t4 = path.join(tmp, 'e.mp4');
  fs.writeFileSync(t4, Buffer.from('not an mp4 at all, just text'));
  check('text file -> NOT_MP4', verifySeal(pub, t4).status === 'NOT_MP4');

  // Cross-platform vectors committed for the Kotlin tests.
  const vpub = fs.readFileSync(path.join(VEC, 'license_pub.pem'), 'utf8');
  const vtok = fs.readFileSync(path.join(VEC, 'token_valid.txt'), 'utf8').trim();
  check('committed vector token verifies', verifyToken(vpub, vtok, new Date('2026-10-21T12:00:00Z')).ok);
  const vs = verifySeal(vpub, path.join(VEC, 'sample_sealed_node.mp4'));
  check('committed sealed vector is VALID', vs.status === 'VALID', JSON.stringify(vs));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
