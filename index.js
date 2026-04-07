'use strict';

/**
 * imgtool-node — MCUboot image signing SDK
 *
 * Programmatic API for signing MCUboot firmware images.
 * Mirrors the Python imgtool `sign` command.
 */

const fs            = require('fs');
const { decodeVersion } = require('./version');
const { loadKey, loadKeyFromPem } = require('./keys');
const { Image }         = require('./image');

// ─── Default options ──────────────────────────────────────────────────────────

/**
 * Default sign options — identical to the defaults used by the CLI.
 * Override only the fields you need.
 */
const DEFAULT_OPTIONS = {
  // Version string — same format as Python imgtool: "maj.min.rev+build"
  version: '1.0.1',

  // Image header size in bytes (0x200 = 512)
  headerSize: 0x200,

  // Flash write-size alignment in bytes
  align: 128,

  // Maximum flash alignment (for trailer size calculation)
  maxAlign: 128,

  // Slot size in bytes (0x30000 = 196608 = 192 KiB)
  slotSize: 0x30000,

  // Maximum number of swap status sectors
  maxSectors: 6,

  // Pad image to slotSize with MCUboot trailer magic
  pad: true,

  // Mark image as confirmed in trailer (implies pad: true)
  confirm: true,

  // CBOR boot record sw_type string (max 12 chars), or null to omit
  bootRecord: 'obdApp',

  // Prepend header-size zeroed bytes before the firmware body
  padHeader: true,

  // How to embed the signing key in the TLV: 'hash' (SHA-256 of public key)
  // or 'full' (raw public key bytes)
  publicKeyFormat: 'hash',

  // Byte order: 'little' or 'big'
  endian: 'little',

  // Value of erased flash bytes (0xff for most NOR flash)
  erasedVal: 0xff,

  // Use overwrite-only upgrade mode (skips swap status area)
  overwriteOnly: false,

  // Security counter: integer, 'auto' (derived from version), or null to omit
  securityCounter: null,
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _resolveOptions(userOpts) {
  const opts = Object.assign({}, DEFAULT_OPTIONS, userOpts);

  // --confirm implies --pad
  if (opts.confirm) opts.pad = true;

  return opts;
}

function _buildImage(opts) {
  // Parse version
  let version;
  try {
    version = decodeVersion(opts.version);
  } catch (e) {
    throw new Error(`Invalid version '${opts.version}': ${e.message}`);
  }

  // Resolve erasedVal
  const erasedVal =
    typeof opts.erasedVal === 'string'
      ? parseInt(opts.erasedVal, 0)
      : opts.erasedVal;

  // Resolve security counter
  let securityCounter = null;
  if (opts.securityCounter !== null && opts.securityCounter !== undefined) {
    if (
      typeof opts.securityCounter === 'string' &&
      opts.securityCounter.toLowerCase() === 'auto'
    ) {
      securityCounter =
        ((version.major << 24) | (version.minor << 16) | version.revision) >>> 0;
    } else {
      securityCounter =
        typeof opts.securityCounter === 'number'
          ? opts.securityCounter
          : parseInt(opts.securityCounter, 0);
      if (isNaN(securityCounter)) throw new Error('Invalid securityCounter value');
    }
  }

  return new Image({
    version,
    headerSize:    opts.headerSize,
    padHeader:     opts.padHeader    || false,
    pad:           opts.pad          || false,
    confirm:       opts.confirm      || false,
    align:         opts.align        || 1,
    slotSize:      opts.slotSize,
    maxSectors:    opts.maxSectors   || 128,
    overwriteOnly: opts.overwriteOnly || false,
    endian:        opts.endian,
    erasedVal,
    securityCounter,
    maxAlign:      opts.maxAlign     || null,
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sign a firmware image supplied as a Buffer and return a signed Buffer.
 *
 * @param {Buffer} inputBuffer   Raw firmware bytes (without MCUboot header)
 * @param {string} keyPath       Path to the PEM private key file
 * @param {object} [userOpts]    Overrides for DEFAULT_OPTIONS
 * @returns {Buffer}             Signed (and optionally padded) MCUboot image
 *
 * @example
 * const { sign } = require('imgtool-node');
 * const raw    = fs.readFileSync('firmware.bin');
 * const signed = sign(raw, 'private-key.pem', { version: '2.0.0' });
 * fs.writeFileSync('firmware_signed.bin', signed);
 */
function sign(inputBuffer, keyPath, userOpts = {}) {
  const opts = _resolveOptions(userOpts);

  // Load key
  const key = loadKey(keyPath);

  // Build image
  const img = _buildImage(opts);

  // Load firmware bytes
  img.loadBuffer(inputBuffer);

  // Sign
  img.create(key, opts.publicKeyFormat || 'hash', null, {
    swType: opts.bootRecord || null,
  });

  // Return Buffer (padTo is applied inside toBuffer() if pad is true)
  return img.toBuffer();
}

/**
 * Sign a firmware file and write the result to disk.
 * Also returns the signed Buffer.
 *
 * @param {string} inputPath     Path to the input firmware binary
 * @param {string} outputPath    Path for the signed output binary
 * @param {string} keyPath       Path to the PEM private key file
 * @param {object} [userOpts]    Overrides for DEFAULT_OPTIONS
 * @returns {Buffer}             Signed MCUboot image buffer
 *
 * @example
 * const { signToFile } = require('imgtool-node');
 * signToFile('firmware.bin', 'firmware_signed.bin', 'private-key.pem');
 */
function signToFile(inputPath, outputPath, keyPath, userOpts = {}) {
  const opts = _resolveOptions(userOpts);

  const key = loadKey(keyPath);
  const img = _buildImage(opts);

  img.load(inputPath);
  img.create(key, opts.publicKeyFormat || 'hash', null, {
    swType: opts.bootRecord || null,
  });

  // save() handles padding internally
  img.save(outputPath);

  // Return the buffer too (re-read from disk to guarantee consistency)
  return fs.readFileSync(outputPath);
}

/**
 * Sign a firmware Buffer using a private key supplied directly as a PEM
 * string or Buffer — no file paths needed.
 *
 * @param {Buffer}        inputBuffer    Raw firmware bytes
 * @param {string|Buffer} privateKeyPem  PEM-encoded private key
 * @param {object}        [userOpts]     Overrides for DEFAULT_OPTIONS (optional)
 * @returns {Buffer}                     Signed (and optionally padded) MCUboot image
 *
 * @example
 * const { signImage } = require('imgtool-node');
 * const fs = require('fs');
 *
 * const firmware   = fs.readFileSync('firmware.bin');
 * const privateKey = fs.readFileSync('private-key.pem');   // Buffer or string
 *
 * const signed = signImage(firmware, privateKey);
 * // or with custom options:
 * const signed = signImage(firmware, privateKey, { version: '2.0.0', slotSize: 0x60000 });
 *
 * fs.writeFileSync('firmware_signed.bin', signed);
 */
function signImage(inputBuffer, privateKeyPem, userOpts = {}) {
  if (!Buffer.isBuffer(inputBuffer)) {
    throw new TypeError('signImage(): inputBuffer must be a Buffer');
  }
  if (typeof privateKeyPem !== 'string' && !Buffer.isBuffer(privateKeyPem)) {
    throw new TypeError('signImage(): privateKeyPem must be a string or Buffer');
  }

  const opts = _resolveOptions(userOpts);
  const key  = loadKeyFromPem(privateKeyPem);
  const img  = _buildImage(opts);

  img.loadBuffer(inputBuffer);
  img.create(key, opts.publicKeyFormat || 'hash', null, {
    swType: opts.bootRecord || null,
  });

  return img.toBuffer();
}

/**
 * Load a key from a PEM file.
 * Re-exported for callers that want to inspect or reuse the KeyWrapper.
 */
const loadKeyFromFile = loadKey;

module.exports = {
  sign,
  signToFile,
  signImage,
  loadKeyFromFile,
  loadKeyFromPem,
  DEFAULT_OPTIONS,
};
