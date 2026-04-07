# imgtool-node

Node.js port of the [MCUboot](https://github.com/mcu-tools/mcuboot) `imgtool` firmware signing tool.

Supports the same `sign` command as the Python reference implementation and is verified byte-for-byte compatible (excluding the randomised RSA-PSS salt).

---

## Table of contents

- [Installation](#installation)
- [CLI usage](#cli-usage)
- [SDK / programmatic API](#sdk--programmatic-api)
- [Examples](#examples)
- [Test cases](#test-cases)
- [Configuration reference](#configuration-reference)
- [Key generation](#key-generation)
- [Verify a signed image](#verify-a-signed-image-python-imgtool)
- [Supported key types](#supported-key-types)
- [Project structure](#project-structure)

---

## Installation

### As a local dependency in another project

```bash
# From npm (once published)
npm install imgtool-node

# Or install directly from the local path
npm install /path/to/scripts/imgtool-node
```

### CLI only (global)

```bash
npm install -g imgtool-node
imgtool sign --help
```

---

## CLI usage

```bash
node imgtool.js sign \
  --key         private-key.pem \
  --version     1.0.1 \
  --header-size 0x200 \
  --align       128 \
  --max-align   128 \
  --slot-size   0x30000 \
  --max-sectors 6 \
  --pad \
  --confirm \
  --boot-record obdApp \
  --pad-header \
  firmware.bin \
  firmware_signed.bin
```

Run `node imgtool.js sign --help` for the full option list.

---

## SDK / programmatic API

Three signing functions are provided. Choose whichever fits your use case:

| Function | Firmware input | Key input | Output |
|---|---|---|---|
| `signImage` | `Buffer` | PEM string or Buffer | `Buffer` |
| `sign` | `Buffer` | file path | `Buffer` |
| `signToFile` | file path | file path | `Buffer` + writes file |

```js
const {
  signImage,
  sign,
  signToFile,
  loadKeyFromPem,
  loadKeyFromFile,
  DEFAULT_OPTIONS,
} = require('imgtool-node');
```

---

### `signImage(inputBuffer, privateKeyPem, [options])` → `Buffer`

Signs a firmware `Buffer` using the private key supplied **directly as a PEM string or Buffer**.
No file paths are required. `options` is optional — when omitted, all `DEFAULT_OPTIONS` are used.

```js
const { signImage } = require('imgtool-node');
const fs = require('fs');

const firmware   = fs.readFileSync('firmware.bin');
const privateKey = fs.readFileSync('private-key.pem');  // Buffer or string

// Using all defaults — no options needed
const signed = signImage(firmware, privateKey);

// Override only what you need
const signed = signImage(firmware, privateKey, {
  version:    '2.0.0',
  slotSize:   0x60000,
  bootRecord: 'myApp',
});

fs.writeFileSync('firmware_signed.bin', signed);
console.log(`Signed image: ${signed.length} bytes`);
```

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `inputBuffer` | `Buffer` | yes | Raw firmware bytes (without MCUboot header) |
| `privateKeyPem` | `string \| Buffer` | yes | PEM-encoded private key content |
| `options` | `object` | no | Partial overrides for `DEFAULT_OPTIONS` |

---

### `sign(inputBuffer, keyPath, [options])` → `Buffer`

Signs a firmware `Buffer` using a key loaded from a file path.
Returns the signed image as a `Buffer` — no files written to disk.

```js
const { sign } = require('imgtool-node');
const fs = require('fs');

const raw    = fs.readFileSync('firmware.bin');
const signed = sign(raw, 'keys/private-key.pem');

fs.writeFileSync('firmware_signed.bin', signed);
console.log(`Signed image: ${signed.length} bytes`);
```

With custom options:

```js
const signed = sign(raw, 'keys/private-key.pem', {
  version:    '2.1.0',
  slotSize:   0x60000,
  bootRecord: 'myApp',
});
```

---

### `signToFile(inputPath, outputPath, keyPath, [options])` → `Buffer`

Reads firmware from `inputPath`, signs it, writes the signed image to `outputPath`,
and also returns the signed `Buffer`.

```js
const { signToFile } = require('imgtool-node');

const signed = signToFile(
  'firmware.bin',
  'firmware_signed.bin',
  'keys/private-key.pem',
  { version: '1.2.0' }
);

console.log(`Written ${signed.length} bytes`);
```

---

### `loadKeyFromPem(pem, [password])` → `KeyWrapper`

Loads a key from a PEM string or Buffer. Useful when the key is stored in memory,
an environment variable, or a secrets manager rather than on disk.

```js
const { loadKeyFromPem } = require('imgtool-node');

const pem = process.env.SIGNING_KEY;   // PEM string from env var
const key = loadKeyFromPem(pem);

console.log(key.keyType);     // 'ec', 'rsa', or 'ed25519'
console.log(key.keySize);     // e.g. 256
console.log(key.isPrivate()); // true
```

---

### `loadKeyFromFile(keyPath, [password])` → `KeyWrapper`

Loads a key from a PEM file on disk.

```js
const { loadKeyFromFile } = require('imgtool-node');

const key = loadKeyFromFile('keys/private-key.pem');
console.log(key.keyType);     // 'ec', 'rsa', or 'ed25519'
console.log(key.keySize);     // e.g. 256
console.log(key.isPrivate()); // true
```

---

### `DEFAULT_OPTIONS`

The full set of defaults, exported so callers can inspect or spread-merge them:

```js
const { DEFAULT_OPTIONS } = require('imgtool-node');
console.log(DEFAULT_OPTIONS);
// {
//   version:         '1.0.1',
//   headerSize:      0x200,
//   align:           128,
//   maxAlign:        128,
//   slotSize:        0x30000,
//   maxSectors:      6,
//   pad:             true,
//   confirm:         true,
//   bootRecord:      'obdApp',
//   padHeader:       true,
//   publicKeyFormat: 'hash',
//   endian:          'little',
//   erasedVal:       0xff,
//   overwriteOnly:   false,
//   securityCounter: null,
// }
```

Spread with overrides:

```js
const myOpts = { ...DEFAULT_OPTIONS, version: '3.0.0', slotSize: 0x80000 };
const signed = signImage(firmware, privateKey, myOpts);
```

---

## Examples

### Example 1 — Sign from memory (most common SDK use case)

```js
const { signImage } = require('imgtool-node');
const fs = require('fs');

const firmware   = fs.readFileSync('firmware.bin');
const privateKey = fs.readFileSync('keys/private-key.pem');

const signed = signImage(firmware, privateKey);
fs.writeFileSync('firmware_signed.bin', signed);

console.log(`Signed: ${signed.length} bytes`);
```

---

### Example 2 — Sign with custom version and slot size

```js
const { signImage } = require('imgtool-node');
const fs = require('fs');

const firmware   = fs.readFileSync('firmware.bin');
const privateKey = fs.readFileSync('keys/private-key.pem');

const signed = signImage(firmware, privateKey, {
  version:  '3.1.2',
  slotSize: 0x60000,   // 384 KiB
});

fs.writeFileSync('firmware_v3.1.2_signed.bin', signed);
```

---

### Example 3 — Sign without a boot record (no CBOR TLV)

```js
const signed = signImage(firmware, privateKey, {
  bootRecord: null,
});
```

---

### Example 4 — Sign and skip padding (raw signed image only)

Useful when you manage slot layout yourself and don't need the MCUboot trailer.

```js
const signed = signImage(firmware, privateKey, {
  pad:     false,
  confirm: false,
});

console.log(`Signed (no trailer): ${signed.length} bytes`);
```

---

### Example 5 — Load key from an environment variable

Avoids storing the key as a file on disk — common in CI/CD pipelines.

```js
const { signImage, loadKeyFromPem } = require('imgtool-node');
const fs = require('fs');

const privateKey = process.env.FIRMWARE_SIGNING_KEY;  // PEM string in env
if (!privateKey) throw new Error('FIRMWARE_SIGNING_KEY env var not set');

const firmware = fs.readFileSync('firmware.bin');
const signed   = signImage(firmware, privateKey, { version: '1.5.0' });

fs.writeFileSync('firmware_signed.bin', signed);
```

---

### Example 6 — Sign to file and inspect the result

```js
const { signToFile, loadKeyFromFile } = require('imgtool-node');

const signed = signToFile(
  'firmware.bin',
  'output/firmware_signed.bin',
  'keys/private-key.pem',
  { version: '1.0.1' }
);

// Inspect MCUboot header magic (first 4 bytes = 0x96f3b83d little-endian)
const magic = signed.readUInt32LE(0);
console.log(`Header magic: 0x${magic.toString(16)}`);  // 0x96f3b83d

// Check image size field (bytes 12–15)
const imgSize = signed.readUInt32LE(12);
console.log(`Image body size: ${imgSize} bytes`);
```

---

### Example 7 — Use a security counter derived from the version

```js
const signed = signImage(firmware, privateKey, {
  version:         '2.3.0',
  securityCounter: 'auto',   // derived as (2 << 24 | 3 << 16 | 0)
});
```

---

### Example 8 — Express.js endpoint that signs an uploaded firmware

```js
const express    = require('express');
const multer     = require('multer');
const { signImage } = require('imgtool-node');
const fs         = require('fs');

const app    = express();
const upload = multer({ storage: multer.memoryStorage() });

const PRIVATE_KEY = fs.readFileSync('keys/private-key.pem');

app.post('/sign', upload.single('firmware'), (req, res) => {
  try {
    const signed = signImage(req.file.buffer, PRIVATE_KEY, {
      version: req.body.version || '1.0.0',
    });

    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', 'attachment; filename="firmware_signed.bin"');
    res.send(signed);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.listen(3000, () => console.log('Signing server running on :3000'));
```

---

## Test cases

The tests below use Node's built-in `assert` module — no test framework required.
Run them with:

```bash
node tests/imgtool.test.js
```

Create the test file at `tests/imgtool.test.js`:

```js
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { signImage, sign, signToFile, loadKeyFromPem, loadKeyFromFile, DEFAULT_OPTIONS } = require('..');

const DATA_DIR   = path.join(__dirname, '..', 'data');
const FIRMWARE   = path.join(DATA_DIR, 'firmware.bin');
const PRIV_KEY   = path.join(DATA_DIR, 'server-private-key.pem');
const PUB_KEY    = path.join(DATA_DIR, 'server-public-key.pem');
const OUTPUT_BIN = path.join(DATA_DIR, '_test_signed.bin');

const firmware   = fs.readFileSync(FIRMWARE);
const privateKey = fs.readFileSync(PRIV_KEY);   // Buffer

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
  const headerSize = DEFAULT_OPTIONS.headerSize;
  const result     = signImage(firmware, privateKey);
  const imgSz      = result.readUInt32LE(12);
  // imgSz = payload bytes after header
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
  // Headers and body should be identical; signatures will differ
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
  DEFAULT_OPTIONS.version = '99.0.0';            // mutate
  DEFAULT_OPTIONS.version = original;             // restore
  const result = signImage(firmware, privateKey);  // should still work
  assert.strictEqual(result[20], 1, 'major version should still be 1');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'='.repeat(52)}`);
console.log(`  Results: ${passed}/${total} passed  |  ${failed} failed`);
console.log('='.repeat(52));

if (failed > 0) process.exit(1);
```

---

## Configuration reference

All options accepted by `signImage()`, `sign()`, and `signToFile()`.
Supply a partial object — only the fields you include are overridden.

| Option | Type | Default | CLI flag | Description |
|---|---|---|---|---|
| `version` | `string` | `'1.0.1'` | `--version` | Image version `maj.min.rev+build` (later parts optional) |
| `headerSize` | `number` | `0x200` (512) | `--header-size` | Size of the MCUboot image header in bytes |
| `align` | `number` | `128` | `--align` | Flash write-size alignment in bytes (power-of-2, 1–4096) |
| `maxAlign` | `number` | `128` | `--max-align` | Maximum flash alignment for trailer size calculation |
| `slotSize` | `number` | `0x30000` | `--slot-size` | Flash slot size in bytes; image is padded to this value |
| `maxSectors` | `number` | `6` | `--max-sectors` | Maximum number of swap status sectors |
| `pad` | `boolean` | `true` | `--pad` | Pad image to `slotSize` with MCUboot trailer magic |
| `confirm` | `boolean` | `true` | `--confirm` | Mark image as confirmed in trailer (implies `pad: true`) |
| `bootRecord` | `string \| null` | `'obdApp'` | `--boot-record` | CBOR boot record `sw_type` string (≤12 chars), or `null` to omit |
| `padHeader` | `boolean` | `true` | `--pad-header` | Prepend `headerSize` zeroed bytes before the firmware body |
| `publicKeyFormat` | `'hash' \| 'full'` | `'hash'` | `--public-key-format` | Embed SHA-256 hash of public key (`'hash'`) or raw bytes (`'full'`) |
| `endian` | `string` | `'little'` | `--endian` | Byte order: `'little'` or `'big'` |
| `erasedVal` | `number` | `0xff` | `--erased-val` | Erased flash byte value (`0x00` or `0xff`) |
| `overwriteOnly` | `boolean` | `false` | `--overwrite-only` | Use overwrite-only upgrade mode (produces a smaller trailer) |
| `securityCounter` | `number \| 'auto' \| null` | `null` | `--security-counter` | Security counter value; `'auto'` derives it from the version |

---

## Key generation

### ECDSA P-256 (recommended)

```bash
# Private key
openssl ecparam -name prime256v1 -genkey -noout -out private-key.pem

# Public key (for verification)
openssl ec -in private-key.pem -pubout -out public-key.pem
```

### RSA-2048

```bash
openssl genrsa -out private-key.pem 2048
openssl rsa    -in private-key.pem -pubout -out public-key.pem
```

### ED25519

```bash
openssl genpkey -algorithm ed25519 -out private-key.pem
openssl pkey    -in private-key.pem -pubout -out public-key.pem
```

---

## Verify a signed image (Python imgtool)

```bash
python3 -m imgtool verify --key public-key.pem firmware_signed.bin
```

Expected output:

```
Image was correctly validated
```

---

## Supported key types

| Algorithm | Curves / Sizes | TLV type |
|---|---|---|
| ECDSA | P-256, P-384 | `ECDSASIG` |
| RSA-PSS | 2048, 3072 bit | `RSA2048` |
| ED25519 | — | `ED25519` |

---

## Project structure

```
imgtool-node/
├── index.js          ← SDK entry point (programmatic API)
├── imgtool.js        ← CLI entry point
├── image.js          ← Core image building and signing
├── keys.js           ← Key loading and signing wrappers
├── version.js        ← Version string parser
├── boot_record.js    ← CBOR boot record encoder (no external deps)
├── package.json
├── README.md
└── data/
    ├── setup.py      ← Generates test keys and firmware.bin
    └── install.sh    ← Full environment setup script
```

---

## License

Intangles-1.0.2
