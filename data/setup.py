#!/usr/bin/env python3
"""
setup.py  —  Generate all files needed in the data/ directory.

Run from inside  scripts/imgtool-node/data/:
    python3 setup.py

Generates:
    data/server-private-key.pem   ECDSA P-256 private key
    data/server-public-key.pem    Matching public key
    data/firmware.bin             4096-byte fake firmware binary
"""

import os
import struct
import random
import subprocess
import sys

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
PRIV_KEY = os.path.join(DATA_DIR, "server-private-key.pem")
PUB_KEY  = os.path.join(DATA_DIR, "server-public-key.pem")
FW_BIN   = os.path.join(DATA_DIR, "firmware.bin")


# ── 1. ECDSA P-256 private key ────────────────────────────────────────────────
print("[1/3] Generating ECDSA P-256 private key ...")
subprocess.run(
    ["openssl", "ecparam", "-name", "prime256v1",
     "-genkey", "-noout", "-out", PRIV_KEY],
    check=True
)
print(f"      {PRIV_KEY}")

# ── 2. Public key (extracted from private key) ────────────────────────────────
print("[2/3] Extracting public key ...")
subprocess.run(
    ["openssl", "ec", "-in", PRIV_KEY, "-pubout", "-out", PUB_KEY],
    check=True, stderr=subprocess.DEVNULL
)
print(f"      {PUB_KEY}")

# ── 3. Fake firmware binary ───────────────────────────────────────────────────
print("[3/3] Building firmware.bin (4096 bytes) ...")

buf = bytearray()

# ARM Cortex-M vector table (first 256 bytes)
buf += struct.pack('<I', 0x20020000)   # initial stack pointer
buf += struct.pack('<I', 0x00000409)   # reset handler (Thumb bit set)
for _ in range(62):                    # remaining exception vectors
    buf += struct.pack('<I', 0x00000501)

# Fake .text  — minimal ARM Thumb-2 instructions
buf += bytes([0x2d, 0xe9, 0x10, 0x40])   # push {r4, lr}
buf += bytes([0x4f, 0xf0, 0x55, 0x00])   # mov  r0, #0x55
buf += bytes([0xff, 0xf7, 0xfe, 0xff])   # bl   <func>
buf += bytes([0xbd, 0xe8, 0x10, 0x40])   # pop  {r4, pc}

# Fake .rodata — version / build strings
buf += b"FW_VERSION=1.0.1\x00"
buf += b"BUILD_DATE=2026-04-07\x00"
buf += b"APP=obdApp\x00"

# Fake .data — config constants
buf += struct.pack('<IIII', 0xDEADBEEF, 0xCAFEBABE, 0x12345678, 0xA5A5A5A5)

# Fill remainder with reproducible pseudo-random bytes
random.seed(0xABCD1234)
remaining = 4096 - len(buf)
buf += bytes([random.randint(0, 255) for _ in range(remaining)])

with open(FW_BIN, 'wb') as f:
    f.write(buf)
print(f"      {FW_BIN}  ({len(buf)} bytes)")

# ── Done ──────────────────────────────────────────────────────────────────────
print()
print("All files ready in:  data/")
print()
print("  server-private-key.pem  — ECDSA P-256 private key  (keep secret)")
print("  server-public-key.pem   — ECDSA P-256 public key   (safe to share)")
print("  firmware.bin            — raw firmware binary (no MCUboot header)")
print()
print("Next step — sign the firmware:")
print()
print("  node ./imgtool.js sign \\")
print("      --key         ./data/server-private-key.pem \\")
print("      --version     1.0.1        \\")
print("      --header-size 0x200        \\")
print("      --align       128          \\")
print("      --max-align   128          \\")
print("      --slot-size   0x30000      \\")
print("      --max-sectors 6            \\")
print("      --pad --confirm            \\")
print("      --boot-record obdApp       \\")
print("      --pad-header               \\")
print("      ./data/firmware.bin        \\")
print("      ./data/my_L2up.bin")
print()
print("Then verify with the PUBLIC key:")
print()
print("  python3 ../imgtool.py verify \\")
print("      --key ./data/server-public-key.pem \\")
print("      ./data/my_L2up.bin")
