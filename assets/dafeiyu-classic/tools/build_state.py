"""Coordination and atomic writes shared by asset generation and packaging."""
from contextlib import contextmanager
import os
from pathlib import Path
import tempfile

INCOMPLETE = '.render-incomplete.json'


@contextmanager
def exclusive_lock(path):
    """Fail fast on an overlapping operation; the OS releases locks on exit.

    Keep the lock file after closing it. Unlinking it would let a third process
    lock a different inode while a second process still holds the original.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError(f'Lock files must not be symlinks: {path}')
    with path.open('a+b') as handle:
        if os.name == 'nt':
            import msvcrt
            if os.fstat(handle.fileno()).st_size == 0:
                handle.write(b'\0')
                handle.flush()
            handle.seek(0)
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                raise OSError(f'Another render/package operation is using {path.parent}') from exc
            try:
                yield
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                raise OSError(f'Another render/package operation is using {path.parent}') from exc
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def build_lock(root):
    return exclusive_lock(Path(root).resolve() / '.render.lock')


@contextmanager
def temporary_path(target, suffix='.tmp'):
    """Own one unique staging file; never remove another writer's staging file."""
    target = Path(target)
    fd, name = tempfile.mkstemp(prefix=f'.{target.stem}-', suffix=suffix, dir=target.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        yield temporary
    finally:
        temporary.unlink(missing_ok=True)


def atomic_bytes(target, data):
    with temporary_path(target) as temporary:
        with temporary.open('wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
