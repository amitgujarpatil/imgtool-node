# imgtool-node — Guide

Node.js port of the MCUboot `imgtool.py sign` command.
Produces byte-for-byte identical images (header, boot record, trailer) to
the Python tool; only the RSA-PSS signature bytes differ per run (expected
— RSA-PSS uses a random salt). Signatures pass Python imgtool verification.

---

## Prerequisites

| Tool | Minimum version | Check |
|------|----------------|-------|
| Node.js | 14 | `node --version` |
| npm | 6 | `npm --version` |
| Python 3 | 3.6 (for verification only) | `python3 --version` |

---

## Install dependencies (one time)

```bash
cd scripts/imgtool-node
npm install
```

---

## Sign a firmware image

### Full command (mirrors the Python tool exactly)

```bash
node scripts/imgtool-node/imgtool.js sign \
  --key          <server-private-key>.pem \
  --version      1.0.1                   \
  --header-size  0x200                   \
  --align        128                     \
  --max-align    128                     \
  --slot-size    0x30000                 \
  --max-sectors  6                       \
  --pad                                  \
  --confirm                              \
  --boot-record  obdApp                  \
  --pad-header                           \
  <name-of-bin-file>.bin                 \
  L1up.bin
```

### What each flag does

| Flag | Value | Meaning |
|------|-------|---------|
| `--key` | `.pem` file | RSA-2048/3072, ECDSA P-256/P-384, or ED25519 private key |
| `--version` | `1.0.1` | Image version written into the header (major.minor.revision+build) |
| `--header-size` | `0x200` | 512-byte header area (must be ≥ 32). Firmware is placed after it. |
| `--align` | `128` | Flash write-size in bytes. Used for the swap status area size. |
| `--max-align` | `128` | Maximum flash alignment across both slots. Sets boot-magic encoding. |
| `--slot-size` | `0x30000` | Total slot size (192 KB). Output file is padded to this size. |
| `--max-sectors` | `6` | Swap status area = `max-sectors × 3 × align` = 2304 bytes |
| `--pad` | flag | Append MCUboot trailer magic at the end of the slot. |
| `--confirm` | flag | Write `image_ok = 0x01` into the trailer (implies `--pad`). |
| `--boot-record` | `obdApp` | CBOR PSA boot record embedded as a protected TLV (max 12 chars). |
| `--pad-header` | flag | Prepend `header-size` bytes of `0xFF` before the input binary. |
| `<infile>` | `.bin` | Raw firmware binary (without MCUboot header). |
| `<outfile>` | `.bin` | Signed, padded output image ready to flash. |

---

## Verify with Python imgtool

```bash
python3 scripts/imgtool.py verify --key <server-private-key>.pem L1up.bin
```

Expected output:
```
Image was correctly validated
Image version: 1.0.1+0
Image digest: <sha256-hex>
```

---

## Use the sample script (sign + verify in one shot)

```bash
cd scripts/imgtool-node/example

./sign_and_verify.sh  <server-private-key>.pem  <firmware.bin>  L1up.bin
```

The script will:
1. Sign the binary using `imgtool-node`
2. Immediately verify the result using `imgtool.py`
3. Print PASS / FAIL with colour output

---

## Output file layout

```
Offset        Size       Content
──────────────────────────────────────────────────────────────────
0x0000        32 B       MCUboot image header
0x0020        480 B      Header padding (0xFF)  ← total header = 0x200
0x0200        imgSz      Firmware binary
0x0200+imgSz  protTLV    Protected TLV area:
                           [magic 0x6908][boot record CBOR]
              unlTLV     Unprotected TLV area:
                           [magic 0x6907][SHA256][KEYHASH][RSA2048 sig]
              padding    0xFF fill up to slot_size - trailer
              trailer    Swap status + metadata + boot magic (2944 B)
──────────────────────────────────────────────────────────────────
Total                    0x30000 (196608 B)
```

### Trailer breakdown (align=128, max-align=128, max-sectors=6, no encryption)

```
trailer = max_sectors × 3 × align     = 6 × 3 × 128  = 2304 B  (swap status)
        + max_align × 4               = 128 × 4       =  512 B  (metadata)
        + align_up(16, max_align)     = 128            =  128 B  (boot magic area)
        ─────────────────────────────────────────────────────────
                                                         2944 B
```

Boot magic for `max-align=128` (little-endian):
```
80 00 2d e1 5d 29 41 0b  8d 77 67 9c 11 0f 1f 8a
```

`image_ok = 0x01` is written at offset `-(128 + 128) = -256` from end of file.

---

## Supported key types

| Type | sig TLV | Notes |
|------|---------|-------|
| RSA-2048 | `RSA2048` | Signs full payload; SHA-256/PSS/salt=32 |
| RSA-3072 | `RSA3072` | Same as above, 3072-bit modulus |
| ECDSA P-256 | `ECDSASIG` | Signs full payload; SHA-256; DER-encoded |
| ECDSA P-384 | `ECDSASIG` | Signs full payload; SHA-384; DER-encoded |
| ED25519 | `ED25519` | Signs pre-computed SHA-256 digest |







Generate ECDSA P-256 Key Pair

  Using OpenSSL (recommended)

  # Generate private key
  openssl ecparam -name prime256v1 -genkey -noout -out server-private-key.pem

  # Extract public key from private key
  openssl ec -in server-private-key.pem -pubout -out server-public-key.pem

  Verify the keys

  # Check private key details
  openssl ec -in server-private-key.pem -text -noout

  # Check public key details
  openssl ec -in server-public-key.pem -pubin -text -noout

  Quick test — sign and verify with the generated key

  # Sign
  node scripts/imgtool-node/imgtool.js sign \
    --key server-private-key.pem \
    --version 1.0.1 \
    --header-size 0x200 \
    --align 128 \
    --max-align 128 \
    --slot-size 0x30000 \
    --max-sectors 6 \
    --pad --confirm \
    --boot-record obdApp \
    --pad-header \
    <name-of-bin-file>.bin L1up.bin

  # Verify (use the private key — imgtool extracts the public key from it)
  python3 scripts/imgtool.py verify --key server-private-key.pem L1up.bin

  ---
  Note: prime256v1 is OpenSSL's name for ECDSA P-256 (secp256r1). The generated PEM will be in the standard SEC1 / PKCS#8
   format that both imgtool-node and imgtool.py accept directly.



node ./imgtool.js sign \
    --key         ./data/server-private-key.pem \
    --version     1.0.1        \
    --header-size 0x200        \
    --align       128          \
    --max-align   128          \
    --slot-size   0x30000      \
    --max-sectors 6            \
    --pad --confirm            \
    --boot-record obdApp       \
    --pad-header               \
    ./data/firmware.bin \
    ./data/my_L2up.bin