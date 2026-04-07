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

33 tests covering all exported functions using Node's built-in `assert` — no test framework required.
The test file is at [`tests/imgtool.test.js`](tests/imgtool.test.js).

| Group | Tests |
|---|---|
| `signImage()` | returns Buffer, correct output size, pad on/off, PEM as string/Buffer, custom version, custom slotSize, header magic, image size field, error on bad input, error on bad version, error on slot overflow, confirm byte, randomised signature |
| `sign()` | returns Buffer, output size, error on missing key file |
| `signToFile()` | writes file, returned Buffer matches disk, output size |
| `loadKeyFromPem()` | loads from Buffer, loads from string, key size detection, error on wrong type |
| `loadKeyFromFile()` | loads from file, error on missing file |
| `DEFAULT_OPTIONS` | is plain object, has all keys, correct default values, mutation isolation |

```bash
npm test
# or
node tests/imgtool.test.js
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

Amit Gujar 1.0.1
