"""Create local deployment configuration. Never print the generated admin key."""

import os
import secrets
from pathlib import Path


def initialize(directory):
    root = Path(directory)
    secret_directory = root / "secrets"
    secret_directory.mkdir(mode=0o700, exist_ok=True)
    if os.name == "posix":
        os.chmod(secret_directory, 0o700)
    key = secret_directory / "admin-key.txt"
    if not key.exists():
        descriptor = os.open(key, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(secrets.token_urlsafe(48) + "\n")
    if os.name == "posix":
        # Compose mounts the file with its host permissions. The private parent directory protects host access.
        os.chmod(key, 0o444)
    configuration = root / ".env"
    if not configuration.exists():
        descriptor = os.open(configuration, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write((root / ".env.example").read_text(encoding="utf-8"))
    return key, configuration


if __name__ == "__main__":
    key, configuration = initialize(Path(__file__).parent)
    print(f"Configuration ready: {configuration.name}")
    print(f"Admin key file: {key.relative_to(Path(__file__).parent)}")
    print("The key is not printed. Read the file locally when signing in. Keep it private.")
