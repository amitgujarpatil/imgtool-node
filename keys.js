'use strict';

// Key loading and signing - mirrors Python imgtool/keys/
const crypto = require('crypto');
const fs     = require('fs');

const RSA_KEY_SIZES = [2048, 3072];

class KeyWrapper {
  /**
   * @param {crypto.KeyObject|null} privateKey
   * @param {crypto.KeyObject}      publicKey
   * @param {'rsa'|'ec'|'ed25519'}  keyType
   * @param {string|null}           keyCurve  e.g. 'prime256v1', 'secp384r1'
   * @param {number}                keySize   bits
   */
  constructor(privateKey, publicKey, keyType, keyCurve, keySize) {
    this.privateKey = privateKey;
    this.publicKey  = publicKey;
    this.keyType    = keyType;
    this.keyCurve   = keyCurve;
    this.keySize    = keySize;
  }

  isPrivate() {
    return this.privateKey !== null;
  }

  isEcdsa384() {
    return this.keyType === 'ec' && this.keyCurve === 'secp384r1';
  }

  /**
   * Returns true for key types that have a sign(fullPayload) method in Python:
   * RSA and ECDSA both hash+sign the full payload.
   * ED25519 uses sign_digest(precomputedDigest) instead.
   */
  signsPayload() {
    return this.keyType !== 'ed25519';
  }

  /** TLV tag name for this key's signature (matches Python key.sig_tlv()) */
  sigTlv() {
    if (this.keyType === 'rsa') {
      return this.keySize === 3072 ? 'RSA3072' : 'RSA2048';
    }
    if (this.keyType === 'ec')      return 'ECDSASIG';
    if (this.keyType === 'ed25519') return 'ED25519';
    throw new Error(`Unknown key type: ${this.keyType}`);
  }

  /**
   * Get public key bytes in the format MCUboot embeds:
   *   RSA    → PKCS#1 DER
   *   ECDSA  → SubjectPublicKeyInfo DER
   *   ED25519 → raw 32-byte public key
   */
  getPublicBytes() {
    if (this.keyType === 'rsa') {
      return this.publicKey.export({ type: 'pkcs1', format: 'der' });
    }
    if (this.keyType === 'ec') {
      return this.publicKey.export({ type: 'spki', format: 'der' });
    }
    if (this.keyType === 'ed25519') {
      // SPKI DER for Ed25519 is: 12-byte header + 32-byte key
      const spki = this.publicKey.export({ type: 'spki', format: 'der' });
      return spki.slice(spki.length - 32);
    }
    throw new Error(`Unknown key type: ${this.keyType}`);
  }

  /**
   * Sign the full binary payload (RSA-PSS or ECDSA-DER).
   * Mirrors Python: key.sign(bytes(payload))
   */
  sign(payload) {
    if (!this.privateKey) throw new Error('sign() requires a private key');

    if (this.keyType === 'rsa') {
      // RSA-PSS / SHA-256 / salt=32  (matches Python PSS(mgf=MGF1(SHA256()), salt_length=32))
      return crypto.sign('SHA256', Buffer.from(payload), {
        key:        this.privateKey,
        padding:    crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      });
    }

    if (this.keyType === 'ec') {
      const hashAlg = this.isEcdsa384() ? 'SHA384' : 'SHA256';
      // ECDSA DER-encoded signature (matches Python ec.ECDSA(SHA256/SHA384))
      return crypto.sign(hashAlg, Buffer.from(payload), {
        key:         this.privateKey,
        dsaEncoding: 'der',
      });
    }

    throw new Error(`Key type '${this.keyType}' does not support sign(payload)`);
  }

  /**
   * Sign a pre-computed digest (ED25519 only).
   * Mirrors Python: key.sign_digest(digest)
   */
  signDigest(digest) {
    if (!this.privateKey) throw new Error('signDigest() requires a private key');

    if (this.keyType === 'ed25519') {
      // Ed25519: signs the digest bytes as the raw message (no extra hashing)
      return crypto.sign(null, Buffer.from(digest), this.privateKey);
    }

    throw new Error(`Key type '${this.keyType}' does not support signDigest()`);
  }
}

/**
 * Build a KeyWrapper from a PEM string, Buffer, or crypto.KeyObject.
 * Shared by loadKey() and loadKeyFromPem().
 *
 * @param {string|Buffer} pem       PEM-encoded key material
 * @param {string|null}   password  Optional passphrase for encrypted keys
 * @param {string}        source    Label used in error messages
 * @returns {KeyWrapper}
 */
function _buildKeyWrapper(pem, password, source) {
  let keyObj;
  let isPrivate = false;

  try {
    const opts = { key: pem, format: 'pem' };
    if (password) opts.passphrase = password;
    keyObj    = crypto.createPrivateKey(opts);
    isPrivate = true;
  } catch (_) {
    try {
      keyObj    = crypto.createPublicKey({ key: pem, format: 'pem' });
      isPrivate = false;
    } catch (e2) {
      throw new Error(`Failed to load key from ${source}: ${e2.message}`);
    }
  }

  const asymKeyType = keyObj.asymmetricKeyType;
  const keyDetails  = keyObj.asymmetricKeyDetails || {};
  const publicKey   = isPrivate ? crypto.createPublicKey(keyObj) : keyObj;
  const privateKey  = isPrivate ? keyObj : null;

  if (asymKeyType === 'rsa') {
    const keySize = keyDetails.modulusLength;
    if (!RSA_KEY_SIZES.includes(keySize)) {
      throw new Error(`Unsupported RSA key size: ${keySize} (allowed: 2048, 3072)`);
    }
    return new KeyWrapper(privateKey, publicKey, 'rsa', null, keySize);
  }

  if (asymKeyType === 'ec') {
    const curve = keyDetails.namedCurve;
    if (!['prime256v1', 'secp384r1'].includes(curve)) {
      throw new Error(`Unsupported EC curve: ${curve} (allowed: prime256v1, secp384r1)`);
    }
    const keySize = curve === 'prime256v1' ? 256 : 384;
    return new KeyWrapper(privateKey, publicKey, 'ec', curve, keySize);
  }

  if (asymKeyType === 'ed25519') {
    return new KeyWrapper(privateKey, publicKey, 'ed25519', null, 256);
  }

  throw new Error(`Unsupported key type: ${asymKeyType}`);
}

/**
 * Load a PEM key file and return a KeyWrapper.
 * Mirrors Python: keys.load(path, passwd)
 */
function loadKey(keyPath, password = null) {
  const pem = fs.readFileSync(keyPath);
  return _buildKeyWrapper(pem, password, `'${keyPath}'`);
}

/**
 * Load a key from a PEM string or Buffer directly (no file I/O).
 *
 * @param {string|Buffer} pem       PEM-encoded private or public key
 * @param {string|null}   password  Optional passphrase for encrypted keys
 * @returns {KeyWrapper}
 *
 * @example
 * const { loadKeyFromPem } = require('imgtool-node');
 * const pem = fs.readFileSync('private-key.pem');
 * const key = loadKeyFromPem(pem);
 */
function loadKeyFromPem(pem, password = null) {
  if (typeof pem !== 'string' && !Buffer.isBuffer(pem)) {
    throw new TypeError('loadKeyFromPem() expects a string or Buffer');
  }
  return _buildKeyWrapper(pem, password, 'PEM string');
}

module.exports = { loadKey, loadKeyFromPem, KeyWrapper };
