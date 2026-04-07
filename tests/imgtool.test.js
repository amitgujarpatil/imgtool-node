'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const {
  signImage,
  sign,
  signToFile,
  loadKeyFromPem,
  loadKeyFromFile,
  DEFAULT_OPTIONS,
} = require('..');

const DATA_DIR   = path.join(__dirname, '..', 'data');
const FIRMWARE   = path.join(DATA_DIR, 'firmware.bin');
const PRIV_KEY   = path.join(DATA_DIR, 'server-private-key.pem');
const OUTPUT_BIN = path.join(DATA_DIR, '_test_signed.bin');

const firmware   = fs.readFileSync(FIRMWARE);
const privateKey = fs.readFileSync(PRIV_KEY);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

// ─── signImage ───────────────────────────────────────────────────────────────

console.log('\n── signImage() ──────────────────────────────────────────────');

test('returns a Buffer', () => {
  const result = signImage(firmware, privateKey);
  assert.ok(Buffer.isBuffer(result), 'expected Buffer');
});

test('output size equals slotSize when pad is true (default)', () => {
  const result = signImage(firmware, privateKey);
  assert.strictEqual(result.length, DEFAULT_OPTIONS.slotSize);
});

test('output size smaller than slotSize when pad is false', () => {
  const result = signImage(firmware, privateKey, { pad: false, confirm: false });
  assert.ok(result.length < DEFAULT_OPTIONS.slotSize, 'expected smaller than slotSize');
});

test('accepts PEM as string', () => {
  const result = signImage(firmware, privateKey.toString());
  assert.ok(Buffer.isBuffer(result));
});

test('accepts PEM as Buffer', () => {
  const result = signImage(firmware, Buffer.from(privateKey));
  assert.ok(Buffer.isBuffer(result));
});

test('uses DEFAULT_OPTIONS when no options passed', () => {
  const result = signImage(firmware, privateKey);
  assert.strictEqual(result.length, DEFAULT_OPTIONS.slotSize);
});

test('respects custom version option', () => {
  // Version 2.0.0 → major byte at offset 20 = 0x02
  const result = signImage(firmware, privateKey, { version: '2.0.0' });
  assert.strictEqual(result[20], 2, 'major version byte should be 2');
});

test('respects custom slotSize option', () => {
  const slotSize = 0x40000;
  const result   = signImage(firmware, privateKey, { slotSize });
  assert.strictEqual(result.length, slotSize);
});

test('MCUboot header magic is correct (0x96f3b83d)', () => {
  const result = signImage(firmware, privateKey);
  const magic  = result.readUInt32LE(0);
  assert.strictEqual(magic, 0x96f3b83d, `unexpected magic: 0x${magic.toString(16)}`);
});

test('image body size field in header matches firmware size', () => {
  const result = signImage(firmware, privateKey);
  const imgSz  = result.readUInt32LE(12);
  assert.strictEqual(imgSz, firmware.length, `imgSz ${imgSz} !== firmware ${firmware.length}`);
});

test('throws TypeError when inputBuffer is not a Buffer', () => {
  assert.throws(
    () => signImage('not-a-buffer', privateKey),
    /inputBuffer must be a Buffer/
  );
});

test('throws TypeError when privateKeyPem is not string or Buffer', () => {
  assert.throws(
    () => signImage(firmware, 12345),
    /privateKeyPem must be a string or Buffer/
  );
});

test('throws on invalid version string', () => {
  assert.throws(
    () => signImage(firmware, privateKey, { version: 'bad-version' }),
    /Invalid version/
  );
});

test('throws when firmware exceeds slot size', () => {
  assert.throws(
    () => signImage(firmware, privateKey, { slotSize: 0x100 }),
    /exceeds slot-size|Cannot pad/
  );
});

test('confirm flag sets image_ok byte in trailer', () => {
  const result        = signImage(firmware, privateKey, { confirm: true });
  const maxAlign      = DEFAULT_OPTIONS.maxAlign;
  const magicAlignSz  = 128; // alignUp(16, 128)
  const imageOkOffset = result.length - (magicAlignSz + maxAlign);
  assert.strictEqual(result[imageOkOffset], 0x01, 'image_ok byte should be 0x01');
});

test('confirm: false does NOT set image_ok byte', () => {
  const result        = signImage(firmware, privateKey, { confirm: false });
  const maxAlign      = DEFAULT_OPTIONS.maxAlign;
  const magicAlignSz  = 128;
  const imageOkOffset = result.length - (magicAlignSz + maxAlign);
  assert.notStrictEqual(result[imageOkOffset], 0x01, 'image_ok should not be set');
});

test('two calls produce different signatures (ECDSA randomised k)', () => {
  const r1 = signImage(firmware, privateKey);
  const r2 = signImage(firmware, privateKey);
  assert.ok(!r1.equals(r2), 'consecutive signed outputs should differ (random k)');
});

// ─── sign() ──────────────────────────────────────────────────────────────────

console.log('\n── sign() ───────────────────────────────────────────────────');

test('returns a Buffer', () => {
  const result = sign(firmware, PRIV_KEY);
  assert.ok(Buffer.isBuffer(result));
});

test('output equals slotSize', () => {
  const result = sign(firmware, PRIV_KEY);
  assert.strictEqual(result.length, DEFAULT_OPTIONS.slotSize);
});

test('throws on missing key file', () => {
  assert.throws(
    () => sign(firmware, '/nonexistent/key.pem'),
    /ENOENT|no such file/i
  );
});

// ─── signToFile() ────────────────────────────────────────────────────────────

console.log('\n── signToFile() ─────────────────────────────────────────────');

test('writes output file', () => {
  if (fs.existsSync(OUTPUT_BIN)) fs.unlinkSync(OUTPUT_BIN);
  signToFile(FIRMWARE, OUTPUT_BIN, PRIV_KEY);
  assert.ok(fs.existsSync(OUTPUT_BIN), 'output file should exist');
  fs.unlinkSync(OUTPUT_BIN);
});

test('returned Buffer matches file on disk', () => {
  const buf  = signToFile(FIRMWARE, OUTPUT_BIN, PRIV_KEY);
  const disk = fs.readFileSync(OUTPUT_BIN);
  assert.ok(buf.equals(disk), 'Buffer should match file contents');
  fs.unlinkSync(OUTPUT_BIN);
});

test('output file size equals slotSize', () => {
  signToFile(FIRMWARE, OUTPUT_BIN, PRIV_KEY);
  const stat = fs.statSync(OUTPUT_BIN);
  assert.strictEqual(stat.size, DEFAULT_OPTIONS.slotSize);
  fs.unlinkSync(OUTPUT_BIN);
});

// ─── loadKeyFromPem() ────────────────────────────────────────────────────────

console.log('\n── loadKeyFromPem() ─────────────────────────────────────────');

test('loads EC private key from Buffer', () => {
  const key = loadKeyFromPem(privateKey);
  assert.strictEqual(key.keyType, 'ec');
  assert.ok(key.isPrivate());
});

test('loads EC private key from string', () => {
  const key = loadKeyFromPem(privateKey.toString());
  assert.strictEqual(key.keyType, 'ec');
  assert.ok(key.isPrivate());
});

test('detects key size correctly (P-256 = 256 bits)', () => {
  const key = loadKeyFromPem(privateKey);
  assert.strictEqual(key.keySize, 256);
});

test('throws TypeError on non-string non-Buffer input', () => {
  assert.throws(
    () => loadKeyFromPem(42),
    /expects a string or Buffer/
  );
});

// ─── loadKeyFromFile() ───────────────────────────────────────────────────────

console.log('\n── loadKeyFromFile() ────────────────────────────────────────');

test('loads private key from file', () => {
  const key = loadKeyFromFile(PRIV_KEY);
  assert.ok(key.isPrivate());
  assert.strictEqual(key.keyType, 'ec');
});

test('throws on missing file', () => {
  assert.throws(
    () => loadKeyFromFile('/nonexistent/key.pem'),
    /ENOENT|no such file/i
  );
});

// ─── DEFAULT_OPTIONS ─────────────────────────────────────────────────────────

console.log('\n── DEFAULT_OPTIONS ──────────────────────────────────────────');

test('is a plain object', () => {
  assert.strictEqual(typeof DEFAULT_OPTIONS, 'object');
  assert.ok(!Array.isArray(DEFAULT_OPTIONS));
});

test('contains all expected keys', () => {
  const required = [
    'version', 'headerSize', 'align', 'maxAlign', 'slotSize',
    'maxSectors', 'pad', 'confirm', 'bootRecord', 'padHeader',
    'publicKeyFormat', 'endian', 'erasedVal', 'overwriteOnly', 'securityCounter',
  ];
  for (const key of required) {
    assert.ok(key in DEFAULT_OPTIONS, `missing key: ${key}`);
  }
});

test('default values match expected constants', () => {
  assert.strictEqual(DEFAULT_OPTIONS.version,         '1.0.1');
  assert.strictEqual(DEFAULT_OPTIONS.headerSize,      0x200);
  assert.strictEqual(DEFAULT_OPTIONS.align,           128);
  assert.strictEqual(DEFAULT_OPTIONS.maxAlign,        128);
  assert.strictEqual(DEFAULT_OPTIONS.slotSize,        0x30000);
  assert.strictEqual(DEFAULT_OPTIONS.maxSectors,      6);
  assert.strictEqual(DEFAULT_OPTIONS.pad,             true);
  assert.strictEqual(DEFAULT_OPTIONS.confirm,         true);
  assert.strictEqual(DEFAULT_OPTIONS.bootRecord,      'obdApp');
  assert.strictEqual(DEFAULT_OPTIONS.padHeader,       true);
  assert.strictEqual(DEFAULT_OPTIONS.publicKeyFormat, 'hash');
  assert.strictEqual(DEFAULT_OPTIONS.endian,          'little');
  assert.strictEqual(DEFAULT_OPTIONS.erasedVal,       0xff);
  assert.strictEqual(DEFAULT_OPTIONS.overwriteOnly,   false);
  assert.strictEqual(DEFAULT_OPTIONS.securityCounter, null);
});

test('mutating DEFAULT_OPTIONS does not affect next signImage call', () => {
  const original = DEFAULT_OPTIONS.version;
  DEFAULT_OPTIONS.version = '99.0.0';
  DEFAULT_OPTIONS.version = original;
  const result = signImage(firmware, privateKey);
  assert.strictEqual(result[20], 1, 'major version should still be 1');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'='.repeat(52)}`);
console.log(`  Results: ${passed}/${total} passed  |  ${failed} failed`);
console.log('='.repeat(52));
console.log();

if (failed > 0) process.exit(1);
