#!/usr/bin/env node
'use strict';

// MCUboot imgtool - Node.js port
// Supports the sign sub-command only.
//
// Usage (equivalent to the Python tool):
//   node imgtool.js sign \
//     --key server-private-key.pem \
//     --version 1.0.1 \
//     --header-size 0x200 \
//     --align 128 \
//     --max-align 128 \
//     --slot-size 0x30000 \
//     --max-sectors 6 \
//     --pad \
//     --confirm \
//     --boot-record obdApp \
//     --pad-header \
//     input.bin output.bin

const { Command } = require('commander');
const { decodeVersion } = require('./version');
const { loadKey }       = require('./keys');
const { Image }         = require('./image');

// ─── Argument parsers ────────────────────────────────────────────────────────

/** Parse a number that may be hex (0x...), octal (0o...) or decimal. */
function basedInt(value) {
  const n = parseInt(value, 0);
  if (isNaN(n)) {
    throw new Error(`'${value}' is not a valid integer (use 0x prefix for hex)`);
  }
  return n;
}

/** Validate and parse --version */
function parseVersion(value) {
  decodeVersion(value);   // throws on invalid format
  return value;
}

/** Validate --align / --max-align */
const VALID_ALIGNS = ['1','2','4','8','16','32','64','128','256','512','1024','2048','4096'];
function parseAlign(value) {
  if (!VALID_ALIGNS.includes(value)) {
    throw new Error(`Invalid alignment '${value}'. Must be one of: ${VALID_ALIGNS.join(', ')}`);
  }
  return parseInt(value, 10);
}

// ─── sign command ────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('imgtool')
  .description('MCUboot image signing tool (Node.js port)');

program
  .command('sign <infile> <outfile>')
  .description('Create a signed MCUboot image')

  // Required
  .requiredOption('-v, --version <version>',     'Image version (e.g. 1.0.1)',   parseVersion)
  .requiredOption('-H, --header-size <bytes>',   'Header size (e.g. 0x200)',     basedInt)
  .requiredOption('-S, --slot-size <bytes>',      'Slot size  (e.g. 0x30000)',    basedInt)

  // Optional
  .option('-k, --key <filename>',                'Signing private key PEM file')
  .option('--align <n>',                         'Flash write-size in bytes',    parseAlign, 1)
  .option('--max-align <n>',                     'Maximum flash alignment',      parseAlign)
  .option('--pad',                               'Pad image to slot-size with trailer magic')
  .option('--confirm',                           'Mark image as confirmed (implies --pad)')
  .option('--pad-header',                        'Prepend header-size zeroed bytes before image')
  .option('-M, --max-sectors <n>',               'Max swap status sectors',      (v) => parseInt(v, 10), 128)
  .option('--boot-record <sw_type>',             'CBOR boot record sw_type (≤12 chars)')
  .option('--public-key-format <fmt>',           'Public key format: hash or full', 'hash')
  .option('-e, --endian <endian>',               'Byte order: little or big',    'little')
  .option('-R, --erased-val <val>',              'Erased flash value: 0 or 0xff')
  .option('--overwrite-only',                    'Use overwrite-only upgrade mode')
  .option('-s, --security-counter <val>',        'Security counter (integer or "auto")')

  .action((infile, outfile, opts) => {
    // ── Resolve options ─────────────────────────────────────────────────────

    // --confirm implies --pad
    if (opts.confirm) opts.pad = true;

    let version;
    try {
      version = decodeVersion(opts.version);
    } catch (e) {
      die(`Invalid --version: ${e.message}`);
    }

    const erasedVal = opts.erasedVal !== undefined
      ? parseInt(opts.erasedVal, 0)
      : 0xff;

    // Security counter
    let securityCounter = null;
    if (opts.securityCounter !== undefined) {
      if (opts.securityCounter.toLowerCase() === 'auto') {
        securityCounter = (
          (version.major    << 24) |
          (version.minor    << 16) |
          (version.revision      )
        ) >>> 0;
      } else {
        securityCounter = parseInt(opts.securityCounter, 0);
        if (isNaN(securityCounter)) die('Invalid --security-counter value');
      }
    }

    // ── Build Image object ──────────────────────────────────────────────────
    const img = new Image({
      version,
      headerSize:   opts.headerSize,
      padHeader:    opts.padHeader    || false,
      pad:          opts.pad          || false,
      confirm:      opts.confirm      || false,
      align:        opts.align        || 1,
      slotSize:     opts.slotSize,
      maxSectors:   opts.maxSectors   || 128,
      overwriteOnly: opts.overwriteOnly || false,
      endian:       opts.endian,
      erasedVal,
      securityCounter,
      maxAlign:     opts.maxAlign     || null,
    });

    // ── Load binary ─────────────────────────────────────────────────────────
    try {
      img.load(infile);
    } catch (e) {
      die(`Failed to load '${infile}': ${e.message}`);
    }

    // ── Load key ────────────────────────────────────────────────────────────
    let key = null;
    if (opts.key) {
      try {
        key = loadKey(opts.key);
      } catch (e) {
        die(`Failed to load key '${opts.key}': ${e.message}`);
      }
    }

    // ── Create signed image ─────────────────────────────────────────────────
    try {
      img.create(key, opts.publicKeyFormat || 'hash', null, {
        swType: opts.bootRecord || null,
      });
    } catch (e) {
      die(`Failed to create signed image: ${e.message}`);
    }

    // ── Save output ─────────────────────────────────────────────────────────
    try {
      img.save(outfile);
    } catch (e) {
      die(`Failed to write '${outfile}': ${e.message}`);
    }

    console.log(`Signed image written to: ${outfile}`);
  });

// ─── version command ─────────────────────────────────────────────────────────

program
  .command('version')
  .description('Print imgtool version')
  .action(() => {
    console.log('imgtool-node 1.0.0 (MCUboot image signing tool)');
  });

// ─── Error helper ────────────────────────────────────────────────────────────

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

program.parse(process.argv);
