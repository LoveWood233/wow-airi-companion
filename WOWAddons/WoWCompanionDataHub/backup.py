"""Create a consistent, private SQLite backup through SQLite's backup API."""

import argparse
import os
from pathlib import Path

from store import Store

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", help="A new file in a writable backup directory")
    args = parser.parse_args()
    os.umask(0o077)
    database = Path(os.getenv("DATAHUB_DATABASE", str(Path(__file__).parent / "data" / "statistics.sqlite")))
    if not database.is_file():
        raise SystemExit("The source database does not exist")
    Store(database).backup(args.destination)
    print("Consistent SQLite backup created.")
