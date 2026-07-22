#!/usr/bin/env node
// Access-key generator for CourtFlow.
//
// Usage:
//   node scripts/generate-key.js              → 1 key
//   node scripts/generate-key.js 25           → 25 keys, one per line (hand these out)
//   node scripts/generate-key.js --sql 25     → 25 keys as SQL, paste into Supabase
//   node scripts/generate-key.js --check KEY  → verify a key's checksum
//
// The checksum only catches typos. The real authority is the access_keys table:
// a key works if and only if a matching unclaimed row exists in the database.

import crypto from 'node:crypto';

// Not a secret, despite the name — it only salts the typo-detecting checksum.
// In the old desktop app this string WAS the security: the client validated keys
// offline, so anyone who extracted it could mint working licences. That is no
// longer true. A key now works only if a matching unclaimed row exists in the
// access_keys table, which no client can read or write. Safe to publish.
const SECRET = 'cf-pklball-lk-7x9m-2024';

function generateKey() {
  const payload = crypto.randomBytes(9).toString('hex').toUpperCase(); // 18 chars
  const checksum = crypto
    .createHmac('sha256', SECRET)
    .update(payload)
    .digest('hex')
    .slice(0, 6)
    .toUpperCase();
  const full = payload + checksum; // 24 chars
  return `${full.slice(0, 6)}-${full.slice(6, 12)}-${full.slice(12, 18)}-${full.slice(18, 24)}`;
}

function validateKey(raw) {
  const k = raw.replace(/-/g, '').toUpperCase();
  if (k.length !== 24 || !/^[0-9A-F]{24}$/.test(k)) return false;
  const payload = k.slice(0, 18);
  const checksum = k.slice(18);
  const expected = crypto
    .createHmac('sha256', SECRET)
    .update(payload)
    .digest('hex')
    .slice(0, 6)
    .toUpperCase();
  return checksum === expected;
}

const args = process.argv.slice(2);

if (args[0] === '--check') {
  const key = args[1];
  if (!key) {
    console.error('Usage: node scripts/generate-key.js --check <KEY>');
    process.exit(1);
  }
  console.log(validateKey(key) ? '✓ VALID' : '✗ INVALID');
} else if (args[0] === '--sql') {
  const count = parseInt(args[1], 10) || 1;
  const keys = Array.from({ length: count }, generateKey);
  console.log('-- CourtFlow access keys, generated ' + new Date().toISOString());
  console.log('-- Paste into the Supabase SQL Editor and run.');
  console.log('insert into access_keys (code) values');
  console.log(keys.map((k) => `  ('${k}')`).join(',\n'));
  console.log('on conflict (code) do nothing;');
  console.log('');
  console.log('-- Keys to hand out (this list is NOT stored anywhere else — keep it):');
  keys.forEach((k) => console.log(`--   ${k}`));
} else {
  const count = parseInt(args[0], 10) || 1;
  for (let i = 0; i < count; i++) console.log(generateKey());
}
