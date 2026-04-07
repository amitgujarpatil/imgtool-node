'use strict';

// Core image creation and signing - mirrors Python imgtool/image.py
const crypto = require('crypto');
const fs     = require('fs');
const { createSwComponentData } = require('./boot_record');

// ─── Constants ───────────────────────────────────────────────────────────────

const IMAGE_MAGIC       = 0x96f3b83d;
const IMAGE_HEADER_SIZE = 32;        // bytes; always 32, independent of --header-size
const DEFAULT_MAX_SECTORS = 128;
const DEFAULT_MAX_ALIGN   = 8;
const MAX_SW_TYPE_LENGTH  = 12;

const IMAGE_F = {
  PIC:             0x0000001,
  ENCRYPTED_AES128: 0x0000004,
  ENCRYPTED_AES256: 0x0000008,
  NON_BOOTABLE:    0x0000010,
  RAM_LOAD:        0x0000020,
  ROM_FIXED:       0x0000100,
};

// TLV type codes
const TLV_VALUES = {
  KEYHASH:    0x01,
  PUBKEY:     0x02,
  SHA256:     0x10,
  SHA384:     0x11,
  RSA2048:    0x20,
  ECDSASIG:   0x22,
  RSA3072:    0x23,
  ED25519:    0x24,
  ENCRSA2048: 0x30,
  ENCKW:      0x31,
  ENCEC256:   0x32,
  ENCX25519:  0x33,
  DEPENDENCY: 0x40,
  SEC_CNT:    0x50,
  BOOT_RECORD: 0x60,
};

const TLV_SIZE          = 4;   // bytes per TLV record header
const TLV_INFO_SIZE     = 4;   // bytes for the TLV area header (magic + total-len)
const TLV_INFO_MAGIC      = 0x6907;
const TLV_PROT_INFO_MAGIC = 0x6908;
const TLV_VENDOR_RES_MIN  = 0x00a0;
const TLV_VENDOR_RES_MAX  = 0xfffe;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function alignUp(num, align) {
  return (num + (align - 1)) & ~(align - 1);
}

// ─── TLV builder ─────────────────────────────────────────────────────────────

/**
 * Mirrors Python class TLV in image.py.
 * All fields are little-endian (endian='little' is the default for imgtool).
 */
class TLV {
  constructor(magic = TLV_INFO_MAGIC) {
    this.magic = magic;
    this.buf   = Buffer.alloc(0);
  }

  get length() {
    return TLV_INFO_SIZE + this.buf.length;
  }

  /**
   * @param {string|number} kind  - Named TLV key (string) or vendor integer
   * @param {Buffer}        payload
   */
  add(kind, payload) {
    let hdr;
    if (typeof kind === 'number') {
      // Custom / vendor TLV: 2-byte type + 2-byte length
      if (kind < TLV_VENDOR_RES_MIN || kind > TLV_VENDOR_RES_MAX) {
        throw new Error(
          `Invalid custom TLV type 0x${kind.toString(16).padStart(4,'0')}; ` +
          `must be 0x${TLV_VENDOR_RES_MIN.toString(16)}–0x${TLV_VENDOR_RES_MAX.toString(16)}`
        );
      }
      hdr = Buffer.allocUnsafe(4);
      hdr.writeUInt16LE(kind,           0);
      hdr.writeUInt16LE(payload.length, 2);
    } else {
      // Standard named TLV: 1-byte type + 1 reserved + 2-byte length
      const typeVal = TLV_VALUES[kind];
      if (typeVal === undefined) throw new Error(`Unknown TLV kind: '${kind}'`);
      hdr = Buffer.allocUnsafe(4);
      hdr.writeUInt8(typeVal,        0);
      hdr.writeUInt8(0,              1);   // reserved
      hdr.writeUInt16LE(payload.length, 2);
    }
    this.buf = Buffer.concat([this.buf, hdr, Buffer.from(payload)]);
  }

  /** Return the complete serialised TLV area (header + records). */
  get() {
    if (this.buf.length === 0) return Buffer.alloc(0);
    const hdr = Buffer.allocUnsafe(4);
    hdr.writeUInt16LE(this.magic,  0);
    hdr.writeUInt16LE(this.length, 2);
    return Buffer.concat([hdr, this.buf]);
  }
}

// ─── Image ───────────────────────────────────────────────────────────────────

class Image {
  /**
   * @param {object} opts
   * @param {{major,minor,revision,build}} opts.version
   * @param {number}  opts.headerSize      Default IMAGE_HEADER_SIZE (32)
   * @param {boolean} opts.padHeader       Prepend header-size bytes of erasedVal
   * @param {boolean} opts.pad             Pad to slotSize with trailer
   * @param {boolean} opts.confirm         Write image_ok=1 into trailer
   * @param {number}  opts.align           Flash write-size (bytes), e.g. 128
   * @param {number}  opts.slotSize        Total slot size in bytes
   * @param {number}  opts.maxSectors      Max swap status sectors (default 128)
   * @param {boolean} opts.overwriteOnly   Overwrite-only upgrade mode
   * @param {string}  opts.endian          'little' (default) or 'big'
   * @param {number}  opts.loadAddr        RAM load address (0 = not RAM-load)
   * @param {number|null} opts.romFixed    ROM-fixed flash address
   * @param {number}  opts.erasedVal       Erased flash byte value (default 0xff)
   * @param {boolean} opts.saveEnctlv      Save encrypted TLV instead of plain key
   * @param {number|null} opts.securityCounter
   * @param {number|null} opts.maxAlign    Explicit max flash alignment
   */
  constructor({
    version,
    headerSize   = IMAGE_HEADER_SIZE,
    padHeader    = false,
    pad          = false,
    confirm      = false,
    align        = 1,
    slotSize     = 0,
    maxSectors   = DEFAULT_MAX_SECTORS,
    overwriteOnly = false,
    endian       = 'little',
    loadAddr     = 0,
    romFixed     = null,
    erasedVal    = 0xff,
    saveEnctlv   = false,
    securityCounter = null,
    maxAlign     = null,
  } = {}) {
    this.version      = version;
    this.headerSize   = headerSize;
    this.padHeader    = padHeader;
    this.pad          = pad;
    this.confirm      = confirm;
    this.align        = align;
    this.slotSize     = slotSize;
    this.maxSectors   = maxSectors;
    this.overwriteOnly = overwriteOnly;
    this.endian       = endian;
    this.loadAddr     = loadAddr || 0;
    this.romFixed     = romFixed;
    this.erasedVal    = erasedVal;
    this.saveEnctlv   = saveEnctlv;
    this.securityCounter = securityCounter;
    this.maxAlign     = maxAlign !== null
      ? parseInt(maxAlign, 10)
      : Math.max(DEFAULT_MAX_ALIGN, align);

    this.payload    = null;   // Buffer, set by load()
    this.enckey     = null;
    this.enctlvLen  = 0;
    this.signature  = null;

    // Boot-magic depends on maxAlign
    if (this.maxAlign === DEFAULT_MAX_ALIGN) {
      this.bootMagic = Buffer.from([
        0x77, 0xc2, 0x95, 0xf3,
        0x60, 0xd2, 0xef, 0x7f,
        0x35, 0x52, 0x50, 0x0f,
        0x2c, 0xb6, 0x79, 0x80,
      ]);
    } else {
      const lsb = this.maxAlign & 0x00ff;
      const msb = (this.maxAlign & 0xff00) >> 8;
      const alignBytes = this.endian === 'big'
        ? Buffer.from([msb, lsb])
        : Buffer.from([lsb, msb]);
      this.bootMagic = Buffer.concat([
        alignBytes,
        Buffer.from([0x2d, 0xe1, 0x5d, 0x29, 0x41, 0x0b,
                     0x8d, 0x77, 0x67, 0x9c, 0x11, 0x0f, 0x1f, 0x8a]),
      ]);
    }
  }

  // ── load ───────────────────────────────────────────────────────────────────

  load(inputPath) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input file not found: ${inputPath}`);
    }
    this.payload = fs.readFileSync(inputPath);

    if (this.padHeader && this.headerSize > 0) {
      // Prepend header-size bytes of erasedVal (0xff by default)
      const hdrPad = Buffer.alloc(this.headerSize, this.erasedVal);
      this.payload = Buffer.concat([hdrPad, this.payload]);
    }

    this._checkHeader();
  }

  /**
   * Load image from a Buffer instead of a file path.
   * @param {Buffer} buffer  Raw firmware bytes
   */
  loadBuffer(buffer) {
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError('loadBuffer() expects a Buffer');
    }
    this.payload = Buffer.from(buffer);

    if (this.padHeader && this.headerSize > 0) {
      const hdrPad = Buffer.alloc(this.headerSize, this.erasedVal);
      this.payload = Buffer.concat([hdrPad, this.payload]);
    }

    this._checkHeader();
  }

  _checkHeader() {
    if (this.headerSize > 0 && !this.padHeader) {
      for (let i = 0; i < this.headerSize; i++) {
        if (this.payload[i] !== 0) {
          throw new Error(
            'Header padding was not requested and image does not start with zeros'
          );
        }
      }
    }
  }

  _checkTrailer() {
    if (this.slotSize > 0) {
      const tsize = this._trailerSize();
      const remaining = this.slotSize - (this.payload.length + tsize);
      if (remaining < 0) {
        throw new Error(
          `Image size (0x${this.payload.length.toString(16)}) + ` +
          `trailer (0x${tsize.toString(16)}) exceeds ` +
          `slot-size 0x${this.slotSize.toString(16)}`
        );
      }
    }
  }

  // ── addHeader ──────────────────────────────────────────────────────────────

  /**
   * Write the 32-byte image header into the first bytes of this.payload.
   * Mirrors Python Image.add_header().
   *
   * Image header layout (little-endian, 32 bytes total):
   *   offset  size  field
   *       0     4   Magic    (0x96f3b83d)
   *       4     4   LoadAddr
   *       8     2   HdrSz
   *      10     2   PTLVSz   (protected-TLV area size including its 4-byte header)
   *      12     4   ImgSz    (payload bytes after the header)
   *      16     4   Flags
   *      20     1   Ver.Major
   *      21     1   Ver.Minor
   *      22     2   Ver.Revision
   *      24     4   Ver.Build
   *      28     4   Pad1     (reserved, zero)
   */
  addHeader(enckey, protectedTlvSize, aesLength = 128) {
    let flags = 0;
    if (enckey !== null) {
      flags |= aesLength === 256 ? IMAGE_F.ENCRYPTED_AES256 : IMAGE_F.ENCRYPTED_AES128;
    }
    if (this.loadAddr !== 0) flags |= IMAGE_F.RAM_LOAD;
    if (this.romFixed)       flags |= IMAGE_F.ROM_FIXED;

    const hdr = Buffer.allocUnsafe(IMAGE_HEADER_SIZE);
    hdr.writeUInt32LE(IMAGE_MAGIC,                          0);
    hdr.writeUInt32LE(this.romFixed || this.loadAddr,       4);
    hdr.writeUInt16LE(this.headerSize,                      8);
    hdr.writeUInt16LE(protectedTlvSize,                    10);
    hdr.writeUInt32LE(this.payload.length - this.headerSize, 12);  // ImgSz
    hdr.writeUInt32LE(flags,                               16);
    hdr.writeUInt8(this.version.major,                     20);
    hdr.writeUInt8(this.version.minor    || 0,             21);
    hdr.writeUInt16LE(this.version.revision || 0,          22);
    hdr.writeUInt32LE(this.version.build    || 0,          24);
    hdr.writeUInt32LE(0,                                   28);  // Pad1

    // Overwrite first IMAGE_HEADER_SIZE bytes in payload
    hdr.copy(this.payload, 0, 0, IMAGE_HEADER_SIZE);
  }

  // ── _trailerSize ───────────────────────────────────────────────────────────

  /**
   * Calculate the MCUboot trailer size.
   * Mirrors Python Image._trailer_size().
   */
  _trailerSize() {
    const magicSize      = 16;
    const magicAlignSize = alignUp(magicSize, this.maxAlign);

    if (this.overwriteOnly) {
      return this.maxAlign * 2 + magicAlignSize;
    }

    const validAligns = [1,2,4,8,16,32,64,128,256,512,1024,2048,4096];
    if (!validAligns.includes(this.align)) {
      throw new Error(`Invalid alignment: ${this.align}`);
    }

    const m = this.maxSectors !== null ? this.maxSectors : DEFAULT_MAX_SECTORS;
    let trailer = m * 3 * this.align;   // swap status area

    if (this.enckey !== null) {
      const keylen = this.saveEnctlv
        ? alignUp(this.enctlvLen, this.maxAlign)
        : alignUp(16, this.maxAlign);
      trailer += keylen * 2;            // two encryption-key slots
    }

    trailer += this.maxAlign * 4;       // image_ok, copy_done, swap_info, swap_size
    trailer += magicAlignSize;          // boot-magic (aligned)
    return trailer;
  }

  // ── padTo ──────────────────────────────────────────────────────────────────

  /**
   * Pad payload to `size` bytes, appending the MCUboot trailer.
   * Mirrors Python Image.pad_to().
   */
  padTo(size) {
    const tsize      = this._trailerSize();
    const paddingLen = size - (this.payload.length + tsize);

    if (paddingLen < 0) {
      throw new Error(
        `Cannot pad: image+trailer (0x${(this.payload.length + tsize).toString(16)}) ` +
        `already exceeds slot-size 0x${size.toString(16)}`
      );
    }

    // Build the trailer bytes:
    //   [paddingLen bytes of erasedVal]
    //   [tsize - bootMagic.length bytes of erasedVal]
    //   [bootMagic]
    const trailerFill = Buffer.alloc(tsize - this.bootMagic.length, this.erasedVal);
    const trailer     = Buffer.concat([
      Buffer.alloc(paddingLen, this.erasedVal),
      trailerFill,
      this.bootMagic,
    ]);

    if (this.confirm && !this.overwriteOnly) {
      // image_ok flag is one byte at offset -(magic_align_size + max_align)
      // from the END of the trailer buffer
      const magicAlignSize = alignUp(16, this.maxAlign);
      const imageOkIdx     = trailer.length - (magicAlignSize + this.maxAlign);
      trailer[imageOkIdx]  = 0x01;
    }

    this.payload = Buffer.concat([this.payload, trailer]);
  }

  // ── create ─────────────────────────────────────────────────────────────────

  /**
   * Sign the loaded image and build the complete output payload.
   * Mirrors Python Image.create().
   *
   * @param {KeyWrapper|null} key               Signing private key
   * @param {'hash'|'full'}   publicKeyFormat   How to embed the public key
   * @param {null}            enckey            Encryption key (not implemented)
   * @param {object}          opts
   * @param {string|null}     opts.swType        boot-record sw_type string
   * @param {object|null}     opts.dependencies  {images:[], versions:[]}
   * @param {object|null}     opts.customTlvs    {tag: Buffer, ...}
   * @param {number}          opts.encryptKeylen 128 or 256 (unused without enckey)
   * @param {object|null}     opts.fixedSig      {value: Buffer}
   * @param {KeyWrapper|null} opts.pubKey        Public key for fixed-sig mode
   */
  create(key, publicKeyFormat, enckey, {
    swType        = null,
    dependencies  = null,
    customTlvs    = null,
    encryptKeylen = 128,
    fixedSig      = null,
    pubKey        = null,
  } = {}) {
    this.enckey = enckey;

    // ── 1. Hash algorithm selection ──────────────────────────────────────────
    // ECDSA-P384 uses SHA-384; everything else uses SHA-256
    const useP384 =
      (key     !== null && key.isEcdsa384())   ||
      (pubKey  !== null && pubKey.isEcdsa384());
    const hashAlgorithm = useP384 ? 'sha384' : 'sha256';
    const hashTlv       = useP384 ? 'SHA384' : 'SHA256';

    // ── 2. Public-key hash ───────────────────────────────────────────────────
    let pub, pubbytes;
    if (key !== null) {
      pub      = key.getPublicBytes();
      pubbytes = crypto.createHash(hashAlgorithm).update(pub).digest();
    } else if (pubKey !== null) {
      pub      = pubKey.getPublicBytes();
      pubbytes = crypto.createHash(hashAlgorithm).update(pub).digest();
    } else {
      // No key at all – fill with zeros matching the hash size
      const digestSize = useP384 ? 48 : 32;
      pubbytes = Buffer.alloc(digestSize);
    }

    // ── 3. Protected-TLV size pre-calculation ────────────────────────────────
    let protectedTlvSize = 0;

    if (this.securityCounter !== null) {
      protectedTlvSize += TLV_SIZE + 4;  // SEC_CNT: header(4) + uint32(4)
    }

    let bootRecord;
    if (swType !== null) {
      if (swType.length > MAX_SW_TYPE_LENGTH) {
        throw new Error(
          `'${swType}' is too long (${swType.length} chars); max is ${MAX_SW_TYPE_LENGTH}`
        );
      }
      const imageVersion = `${this.version.major}.${this.version.minor}.${this.version.revision}`;
      const digestZeros  = Buffer.alloc(useP384 ? 48 : 32);
      bootRecord = createSwComponentData(swType, imageVersion, hashTlv, digestZeros, pubbytes);
      protectedTlvSize += TLV_SIZE + bootRecord.length;
    }

    if (dependencies !== null) {
      // Each DEPENDENCY TLV payload is 12 bytes: B 3x BB H I
      protectedTlvSize += dependencies.images.length * 16;  // 4 hdr + 12 payload
    }

    if (customTlvs !== null) {
      for (const value of Object.values(customTlvs)) {
        protectedTlvSize += TLV_SIZE + value.length;
      }
    }

    if (protectedTlvSize !== 0) {
      protectedTlvSize += TLV_INFO_SIZE;  // the protected-TLV area header
    }

    // ── 4. Write image header ────────────────────────────────────────────────
    this.addHeader(enckey, protectedTlvSize, encryptKeylen);

    // ── 5. Build protected TLV area ──────────────────────────────────────────
    const protTlv = new TLV(TLV_PROT_INFO_MAGIC);
    let protectedTlvOff = null;

    if (protectedTlvSize !== 0) {
      if (this.securityCounter !== null) {
        const scBuf = Buffer.allocUnsafe(4);
        scBuf.writeUInt32LE(this.securityCounter, 0);
        protTlv.add('SEC_CNT', scBuf);
      }

      if (swType !== null) {
        protTlv.add('BOOT_RECORD', bootRecord);
      }

      if (dependencies !== null) {
        for (let i = 0; i < dependencies.images.length; i++) {
          // struct: B 3x  BB H I  → 1+3+1+1+2+4 = 12 bytes
          const depBuf = Buffer.allocUnsafe(12);
          depBuf.writeUInt8(parseInt(dependencies.images[i], 10), 0);
          depBuf.writeUInt8(0, 1); depBuf.writeUInt8(0, 2); depBuf.writeUInt8(0, 3);
          depBuf.writeUInt8(dependencies.versions[i].major,          4);
          depBuf.writeUInt8(dependencies.versions[i].minor,          5);
          depBuf.writeUInt16LE(dependencies.versions[i].revision,    6);
          depBuf.writeUInt32LE(dependencies.versions[i].build,       8);
          protTlv.add('DEPENDENCY', depBuf);
        }
      }

      if (customTlvs !== null) {
        for (const [tag, value] of Object.entries(customTlvs)) {
          protTlv.add(parseInt(tag, 0), value);
        }
      }

      // Append protected TLVs to payload so they are included in the hash
      protectedTlvOff = this.payload.length;
      this.payload = Buffer.concat([this.payload, protTlv.get()]);
    }

    // ── 6. Compute hash over header + image + protected TLVs ─────────────────
    const digest = crypto.createHash(hashAlgorithm).update(this.payload).digest();

    // ── 7. Build unprotected TLV area ────────────────────────────────────────
    const tlv = new TLV(TLV_INFO_MAGIC);
    tlv.add(hashTlv, digest);

    if (key !== null || fixedSig !== null) {
      // Embed public key or its hash
      if (publicKeyFormat === 'hash') {
        tlv.add('KEYHASH', pubbytes);
      } else {
        tlv.add('PUBKEY', pub);
      }

      if (key !== null && fixedSig === null) {
        // RSA/ECDSA hash+sign the full payload; ED25519 signs the digest
        let sig;
        if (key.signsPayload()) {
          process.stdout.write(`image.js: sign the payload\n`);
          sig = key.sign(this.payload);
        } else {
          process.stdout.write(`image.js: sign the digest\n`);
          sig = key.signDigest(digest);
        }
        tlv.add(key.sigTlv(), sig);
        this.signature = sig;

      } else if (fixedSig !== null && key === null) {
        tlv.add(pubKey.sigTlv(), fixedSig.value);
        this.signature = fixedSig.value;

      } else {
        throw new Error('Cannot sign using key and also provide fixed-signature simultaneously');
      }
    }

    // ── 8. Remove protected TLVs from payload (they'll be re-appended below) ─
    if (protectedTlvOff !== null) {
      this.payload = this.payload.slice(0, protectedTlvOff);
    }

    // ── 9. Re-append protected TLVs + append unprotected TLVs ────────────────
    this.payload = Buffer.concat([this.payload, protTlv.get(), tlv.get()]);

    this._checkTrailer();
  }

  // ── save ───────────────────────────────────────────────────────────────────

  /**
   * Return the final signed image as a Buffer (without writing to disk).
   * Padding is applied if `this.pad` is set, same as save().
   * @returns {Buffer}
   */
  toBuffer() {
    if (this.pad) {
      this.padTo(this.slotSize);
    }
    return Buffer.from(this.payload);
  }

  save(outputPath) {
    if (this.pad) {
      this.padTo(this.slotSize);
    }
    fs.writeFileSync(outputPath, this.payload);
  }

  getSignature() {
    return this.signature;
  }
}

module.exports = { Image, TLV_VALUES, TLV_INFO_MAGIC, IMAGE_MAGIC, IMAGE_HEADER_SIZE };
