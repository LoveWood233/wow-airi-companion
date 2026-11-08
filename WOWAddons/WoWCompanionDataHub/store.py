"""Transactional installation checkpoints and receive-day usage totals."""

import hashlib
import hmac
import json
import sqlite3
import time
from contextlib import closing, contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

COUNTERS = (
    "requests", "requestsWithUsage", "requestsWithoutUsage", "inputTokens", "outputTokens", "totalTokens",
    "inputReportedRequests", "outputReportedRequests", "totalReportedRequests",
)
APPLICATION_ID = 0x57434448


class Conflict(Exception):
    pass


class Unauthorized(Exception):
    pass


def utc(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z")


class Store:
    def __init__(self, path, clock=time.time):
        self.path = Path(path)
        self.clock = clock
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            identifier = db.execute("PRAGMA application_id").fetchone()[0]
            version = db.execute("PRAGMA user_version").fetchone()[0]
            tables = db.execute("SELECT count(*) FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchone()[0]
            if (identifier, version) != (APPLICATION_ID, 1) and (identifier, version, tables) != (0, 0, 0):
                raise ValueError("Unsupported statistics database")
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("PRAGMA synchronous=FULL")
            if version == 0:
                columns = ",".join(f'"{key}" INTEGER NOT NULL DEFAULT 0' for key in COUNTERS)
                db.executescript(f"""BEGIN IMMEDIATE;
                    CREATE TABLE installations(id TEXT PRIMARY KEY,secret_hash TEXT NOT NULL,created_at REAL NOT NULL,
                      last_seen REAL NOT NULL,version TEXT NOT NULL,platform TEXT NOT NULL,sequence INTEGER NOT NULL DEFAULT 0,
                      body_hash TEXT NOT NULL DEFAULT '',{columns});
                    CREATE TABLE daily_usage(day TEXT NOT NULL,installation_id TEXT NOT NULL,{columns},
                      PRIMARY KEY(day,installation_id),FOREIGN KEY(installation_id) REFERENCES installations(id) ON DELETE CASCADE);
                    CREATE INDEX installations_last_seen ON installations(last_seen);
                    PRAGMA application_id={APPLICATION_ID}; PRAGMA user_version=1; COMMIT;""")
            db.execute(f'SELECT id,secret_hash,created_at,last_seen,version,platform,sequence,body_hash,{self.columns()} FROM installations LIMIT 0')
            db.execute(f'SELECT day,installation_id,{self.columns()} FROM daily_usage LIMIT 0')

    @staticmethod
    def columns():
        return ",".join(f'"{key}"' for key in COUNTERS)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("PRAGMA busy_timeout=5000")
            yield db
        finally:
            db.close()

    @staticmethod
    def secret_hash(secret):
        return hashlib.sha256(secret.encode("ascii")).hexdigest()

    def authenticate(self, db, installation_id, secret):
        row = db.execute("SELECT * FROM installations WHERE id=?", (installation_id,)).fetchone()
        if row is None or not hmac.compare_digest(row["secret_hash"], self.secret_hash(secret)):
            raise Unauthorized()
        return row

    def register(self, installation_id, secret, version, platform):
        now = self.clock()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                row = db.execute("SELECT secret_hash FROM installations WHERE id=?", (installation_id,)).fetchone()
                if row is not None:
                    if not hmac.compare_digest(row["secret_hash"], self.secret_hash(secret)):
                        raise Conflict("installation-conflict")
                    # Registration retries preserve both the original install time and activity time.
                    db.execute("UPDATE installations SET version=?,platform=? WHERE id=?", (version, platform, installation_id))
                    created = False
                else:
                    db.execute("INSERT INTO installations(id,secret_hash,created_at,last_seen,version,platform) VALUES(?,?,?,?,?,?)",
                               (installation_id, self.secret_hash(secret), now, now, version, platform))
                    created = True
                db.execute("COMMIT")
            except Exception:
                db.execute("ROLLBACK")
                raise
        return created, utc(now)

    def observe(self, installation_id, secret, sequence, counters):
        now = self.clock()
        body_hash = hashlib.sha256(json.dumps(counters, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        day = datetime.fromtimestamp(now, timezone.utc).date().isoformat()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                row = self.authenticate(db, installation_id, secret)
                if sequence < row["sequence"]:
                    status = "stale"
                elif sequence == row["sequence"]:
                    if body_hash != row["body_hash"]:
                        raise Conflict("sequence-conflict")
                    status = "duplicate"
                else:
                    delta = {key: counters[key] - row[key] for key in COUNTERS}
                    if any(value < 0 for value in delta.values()):
                        raise Conflict("counter-regression")
                    values = tuple(counters[key] for key in COUNTERS)
                    assignments = ",".join(f'"{key}"=?' for key in COUNTERS)
                    db.execute(f"UPDATE installations SET sequence=?,body_hash=?,{assignments} WHERE id=?", (sequence, body_hash, *values, installation_id))
                    additions = ",".join(f'"{key}"=daily_usage."{key}"+excluded."{key}"' for key in COUNTERS)
                    placeholders = ",".join("?" for _ in COUNTERS)
                    db.execute(f"INSERT INTO daily_usage(day,installation_id,{self.columns()}) VALUES(?,?,{placeholders}) "
                               f"ON CONFLICT(day,installation_id) DO UPDATE SET {additions}", (day, installation_id, *(delta[key] for key in COUNTERS)))
                    status = "accepted"
                db.execute("UPDATE installations SET last_seen=? WHERE id=?", (now, installation_id))
                current_sequence = db.execute("SELECT sequence FROM installations WHERE id=?", (installation_id,)).fetchone()[0]
                db.execute("COMMIT")
            except Exception:
                db.execute("ROLLBACK")
                raise
        return {"ok": True, "status": status, "sequence": current_sequence, "serverTime": utc(now)}

    def stats(self, days):
        now = self.clock()
        today = datetime.fromtimestamp(now, timezone.utc).date()
        daily = {str(today - timedelta(days=offset)): {key: 0 for key in COUNTERS} for offset in range(days - 1, -1, -1)}
        totals = {key: 0 for key in COUNTERS}
        with self.connection() as db:
            # One read transaction makes the installation count and totals one coherent snapshot.
            db.execute("BEGIN")
            rows = db.execute(f"SELECT version,last_seen,{self.columns()} FROM installations").fetchall()
            versions = {}
            for row in rows:
                versions[row["version"]] = versions.get(row["version"], 0) + 1
                for key in COUNTERS:
                    totals[key] += row[key]
            for row in db.execute(f"SELECT day,{self.columns()} FROM daily_usage WHERE day>=? AND day<=?", (next(iter(daily)), str(today))):
                if row["day"] in daily:
                    for key in COUNTERS:
                        daily[row["day"]][key] += row[key]
            db.execute("COMMIT")
        return {
            "generatedAt": utc(now), "periodDays": days, "totalInstallations": len(rows),
            "activeInstallations5m": sum(row["last_seen"] >= now - 300 for row in rows),
            "activeInstallations24h": sum(row["last_seen"] >= now - 86400 for row in rows),
            "totals": totals, "daily": [{"day": day, **values} for day, values in daily.items()],
            "versions": [{"version": version, "installations": count} for version, count in sorted(versions.items())],
        }

    def backup(self, destination):
        """Create a consistent SQLite backup without copying a live WAL file."""
        target = Path(destination)
        if target.exists() or target.resolve() == self.path.resolve():
            raise ValueError("Choose a new backup file")
        with self.connection() as source:
            with closing(sqlite3.connect(target)) as output:
                source.backup(output)
