"""EDAE v1 vektörlerini bağımsız bir uygulamayla (Python `cryptography`) doğrular (033 §4.6).

TypeScript uygulamasından hiçbir kod paylaşmaz: biçim belgeden (033 §4.2-§4.3) yeniden yazılmıştır.
Kullanım: python3 -I tests/crypto-xcheck/verify.py   (çıkış kodu 0 = tüm vektörler uyumlu)
"""
import hashlib
import json
import struct
import sys
import uuid
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

SEG = 65536
VECTORS = Path(__file__).resolve().parents[2] / "packages/crypto/test/vectors/edae-v1.json"


def variant_key(file_key: bytes, variant: str) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None,
                info=b"eda/v1/variant/" + variant.encode()).derive(file_key)


def plain(n: int) -> bytes:
    return bytes((i * 31 + 7) & 0xFF for i in range(n))


def encrypt(key: bytes, org: str, file: str, key_version: int, prefix: bytes, data: bytes) -> bytes:
    header = b"EDAE" + bytes([1, 1, 16, 0]) + struct.pack(">I", key_version) + prefix + b"\x00" * 4
    chunks = [data[i:i + SEG] for i in range(0, len(data), SEG)]
    out = [header]
    for n, chunk in enumerate(chunks):
        is_last = n == len(chunks) - 1
        aad = (uuid.UUID(org).bytes + uuid.UUID(file).bytes + struct.pack(">I", key_version)
               + struct.pack(">I", n) + bytes([1 if is_last else 0]))
        out.append(AESGCM(key).encrypt(prefix + struct.pack(">I", n), chunk, aad))
    return b"".join(out)


def main() -> int:
    doc = json.loads(VECTORS.read_text(encoding="utf-8"))
    file_key = bytes.fromhex(doc["fileKey"])
    prefix = bytes.fromhex(doc["noncePrefix"])
    failed = 0
    for v in doc["vectors"]:
        key = variant_key(file_key, v["variant"])
        obj = encrypt(key, doc["orgId"], doc["fileId"], doc["keyVersion"], prefix, plain(v["plainBytes"]))
        ok = (len(obj) == v["objectBytes"] and obj[:24].hex() == v["header"]
              and obj[24:56].hex() == v["firstSegmentTail"]
              and hashlib.sha256(obj).hexdigest() == v["objectSha256"])
        print(("OK   " if ok else "FAIL ") + f"{v['variant']} {v['plainBytes']}")
        failed += 0 if ok else 1
    return 1 if failed else 0


sys.exit(main())
