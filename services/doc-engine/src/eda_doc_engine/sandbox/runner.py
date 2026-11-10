"""İstek başı alt süreç çalıştırıcısı (033 §7.5, 061 CTL-FILE-03; P19a.11).

Her görev ayrı bir Python alt sürecinde, `/tmp/job-<uuid>` (0700) çalışma dizininde, temiz bir
ortamla koşar. Alt süreç ilk iş olarak kendi `RLIMIT_*` sınırlarını uygular (`child.py`), sonra
girdiyi okur. Duvar saati aşımında süreç grubu `SIGKILL` alır. Ek `unshare -n` KULLANILMAZ:
`cap_drop: [ALL]` altında çalışmaz; ağ yalıtımı `docproc` ağı + çıkışsızlıkla sağlanır (061 notu).
Dizin adı sunucuda üretilir; kullanıcı verisinden yol/ad üretilmez.
"""

import asyncio
import contextlib
import os
import shutil
import signal
import sys
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import eda_doc_engine

_SRC_ROOT: Final = str(Path(eda_doc_engine.__file__).resolve().parents[1])
_CHILD_MODULE: Final = "eda_doc_engine.sandbox.child"
JOB_DIR_PREFIX: Final = "job-"


class SandboxError(Exception):
    """Alt süreç sıfır dışı çıktı verdi (ayrıntı loglanmaz: belge içeriği taşıyabilir)."""

    def __init__(self, returncode: int) -> None:
        super().__init__(f"alt süreç çıkış kodu {returncode}")
        self.returncode = returncode


class SandboxTimeout(Exception):
    """Duvar saati sınırı aşıldı; süreç grubu öldürüldü."""


def clean_env(home: Path) -> dict[str, str]:
    """Alt sürecin tek ortamı: üst süreçten hiçbir değişken (sır yolu dahil) devralınmaz."""
    return {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": str(home),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PYTHONPATH": _SRC_ROOT,
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONHASHSEED": "0",
        "PYTHONUNBUFFERED": "1",
        "OMP_THREAD_LIMIT": "1",
        "TMPDIR": str(home),
    }


def create_job_dir(root: Path | None = None) -> Path:
    """`<tmp>/job-<uuid4>` (0700). Ad sunucuda üretilir."""
    base = root if root is not None else Path(tempfile.gettempdir())
    path = base / f"{JOB_DIR_PREFIX}{uuid.uuid4()}"
    path.mkdir(mode=0o700)
    return path


def remove_job_dir(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)


@dataclass(frozen=True, slots=True)
class TaskResult:
    stdout: bytes


async def run_task(task: str, payload: bytes, cwd: Path, timeout_sec: float) -> TaskResult:
    """`child.py` içindeki sabit görev kümesinden birini alt süreçte koşar."""
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        "-B",
        "-m",
        _CHILD_MODULE,
        task,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        cwd=cwd,
        env=clean_env(cwd),
        start_new_session=True,
        close_fds=True,
    )
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(payload), timeout=timeout_sec)
    except TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGKILL)
        await proc.wait()
        raise SandboxTimeout from None
    except BaseException:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGKILL)
        await proc.wait()
        raise
    if proc.returncode != 0:
        raise SandboxError(proc.returncode if proc.returncode is not None else -1)
    return TaskResult(stdout)
