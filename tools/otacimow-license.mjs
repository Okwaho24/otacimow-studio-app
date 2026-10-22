#!/usr/bin/env node
// Operator CLI: node tools/otacimow-license.mjs <keygen|issue|verify-token|verify-seal> [options]
// The private key never leaves ~/.otacimow/ and is never printed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { issueToken, verifyToken, verifySeal } from './license-lib.mjs';

const HOME = os.homedir();
const DIR = path.join(HOME, '.otacimow');
const PRIV = process.env.OTACIMOW_LICENSE_KEY || path.join(DIR, 'license_private.pem');
const DEFAULT_PUB = path.resolve('android/app/src/main/assets/license_pub.pem');

function opts(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) o[k] = true; else { o[k] = next; i++; }
    } else o._.push(a);
  }
  return o;
}
const die = (m) => { console.error('ERROR: ' + m); process.exit(1); };
const readPub = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return die(`cannot read public key ${p}`); } };

const [cmd, ...rest] = process.argv.slice(2);
const o = opts(rest);

switch (cmd) {
  case 'keygen': {
    const pubOut = typeof o.pub === 'string' ? path.resolve(o.pub) : DEFAULT_PUB;
    if (fs.existsSync(PRIV)) die(`private key already exists at ${PRIV}. Refusing to overwrite.`);
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    fs.writeFileSync(PRIV, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
    fs.mkdirSync(path.dirname(pubOut), { recursive: true });
    const spki = publicKey.export({ type: 'spki', format: 'der' });
    fs.writeFileSync(pubOut, publicKey.export({ type: 'spki', format: 'pem' }));
    console.log(`Private key written: ${PRIV} (mode 600, not shown)`);
    console.log(`Public key written:  ${pubOut}`);
    console.log(`Public key SHA-256:  ${crypto.createHash('sha256').update(spki).digest('hex')}`);
    console.log('BACK UP the private key file now. If it is lost, no new licenses can be issued.');
    break;
  }
  case 'issue': {
    if (!fs.existsSync(PRIV)) die(`no private key at ${PRIV}. Run keygen first.`);
    let tid = typeof o.tid === 'string' ? o.tid : null;
    if (o.new) tid = 'T-' + crypto.randomBytes(6).toString('hex');
    if (!tid) die('give --tid <id> or --new');
    let exp = null;
    if (o.days !== undefined) {
      const days = Number(o.days);
      if (!Number.isInteger(days) || days < 1 || days > 3650) die('--days must be an integer 1..3650');
      exp = new Date(Date.now() + days * 86400000);
    }
    const iat = new Date();
    const token = issueToken(fs.readFileSync(PRIV, 'utf8'), { tid, iat, exp });
    const note = typeof o.note === 'string' ? o.note.replace(/[\t\r\n]/g, ' ') : '';
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    fs.appendFileSync(path.join(DIR, 'issued.tsv'), [iat.toISOString(), tid, exp ? exp.toISOString() : '', note].join('\t') + '\n', { mode: 0o600 });
    console.log(token);
    break;
  }
  case 'verify-token': {
    const token = o._[0] || die('usage: verify-token <token> [--pub file]');
    const r = verifyToken(readPub(typeof o.pub === 'string' ? o.pub : DEFAULT_PUB), token);
    console.log(r.ok ? `VALID tid=${r.license.tid}` : `INVALID ${r.reason}`);
    process.exit(r.ok ? 0 : 2);
    break;
  }
  case 'verify-seal': {
    const file = o._[0] || die('usage: verify-seal <file.mp4> [--pub file]');
    const r = verifySeal(readPub(typeof o.pub === 'string' ? o.pub : DEFAULT_PUB), file);
    console.log(`${r.status}${r.tid ? ` tid=${r.tid}` : ''}${r.ts ? ` sealed=${r.ts}` : ''}${r.sha256 ? ` sha256=${r.sha256}` : ''}${r.licenseError ? ` (${r.licenseError})` : ''}`);
    process.exit(r.status === 'VALID' ? 0 : 2);
    break;
  }
  default:
    console.error('usage: otacimow-license.mjs <keygen|issue|verify-token|verify-seal>\n' +
      '  keygen [--pub file]\n  issue (--tid ID | --new) [--days N] [--note TEXT]\n' +
      '  verify-token TOKEN [--pub file]\n  verify-seal FILE [--pub file]');
    process.exit(1);
}
