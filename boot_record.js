'use strict';

// CBOR-encoded PSA boot record - mirrors Python imgtool/boot_record.py
// SwComponent property IDs from Arm PSA Attestation API 1.0
const SwComponent = {
  TYPE:                    1,
  MEASUREMENT_VALUE:       2,
  VERSION:                 4,
  SIGNER_ID:               5,
  MEASUREMENT_DESCRIPTION: 6,
};

// Minimal CBOR encoder for the boot record structure.
// Supports: positive integers (keys), UTF-8 text strings, byte strings.
// This avoids an external CBOR dependency while producing spec-compliant output
// that is byte-for-byte identical to Python's cbor2.dumps() for this structure.

function cborUint(n) {
  // Encode a non-negative integer as a CBOR unsigned integer
  if (n <= 0x17) return Buffer.from([n]);
  if (n <= 0xff) return Buffer.from([0x18, n]);
  if (n <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0x19; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = 0x1a; b.writeUInt32BE(n, 1); return b;
}

function cborText(str) {
  // Encode a UTF-8 string as a CBOR text string (major type 3)
  const strBuf = Buffer.from(str, 'utf8');
  const len = strBuf.length;
  let hdr;
  if (len <= 0x17)       hdr = Buffer.from([0x60 | len]);
  else if (len <= 0xff)  hdr = Buffer.from([0x78, len]);
  else                   { hdr = Buffer.alloc(3); hdr[0] = 0x79; hdr.writeUInt16BE(len, 1); }
  return Buffer.concat([hdr, strBuf]);
}

function cborBytes(buf) {
  // Encode a Buffer as a CBOR byte string (major type 2)
  const len = buf.length;
  let hdr;
  if (len <= 0x17)       hdr = Buffer.from([0x40 | len]);
  else if (len <= 0xff)  hdr = Buffer.from([0x58, len]);
  else                   { hdr = Buffer.alloc(3); hdr[0] = 0x59; hdr.writeUInt16BE(len, 1); }
  return Buffer.concat([hdr, buf]);
}

function cborMapHeader(count) {
  // Encode a CBOR map header (major type 5)
  if (count <= 0x17) return Buffer.from([0xa0 | count]);
  return Buffer.from([0xb8, count]);
}

/**
 * Create CBOR-encoded SW component data for the BOOT_RECORD TLV.
 *
 * Mirrors Python: create_sw_component_data(sw_type, sw_version,
 *                   sw_measurement_description, sw_measurement_value,
 *                   sw_signer_id)
 *
 * IMPORTANT: MEASUREMENT_VALUE (key 2) must be last so the bootloader
 * can patch it in place after verifying the image hash.
 */
function createSwComponentData(
  swType,                    // string, e.g. "obdApp"
  swVersion,                 // string, e.g. "1.0.1"
  swMeasurementDescription,  // string, e.g. "SHA256"
  swMeasurementValue,        // Buffer (hash-sized zeros at sign time)
  swSignerId                 // Buffer (hash of public key)
) {
  // Insertion order: TYPE, VERSION, SIGNER_ID, MEASUREMENT_DESCRIPTION,
  //                  MEASUREMENT_VALUE (must be last per PSA spec)
  const entries = [
    [SwComponent.TYPE,                    cborText(swType)],
    [SwComponent.VERSION,                 cborText(swVersion)],
    [SwComponent.SIGNER_ID,               cborBytes(swSignerId)],
    [SwComponent.MEASUREMENT_DESCRIPTION, cborText(swMeasurementDescription)],
    [SwComponent.MEASUREMENT_VALUE,       cborBytes(swMeasurementValue)],
  ];

  const parts = [cborMapHeader(entries.length)];
  for (const [key, valueBuf] of entries) {
    parts.push(cborUint(key));
    parts.push(valueBuf);
  }
  return Buffer.concat(parts);
}

module.exports = { createSwComponentData };
