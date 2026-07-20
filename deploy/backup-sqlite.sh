#!/usr/bin/env bash
#
# backup-sqlite.sh — nightly online backup of the OpenRater books of record.
#
# Runs on the HOST (not in a container) from cron. Uses SQLite's online
# `.backup` command, which is WAL-safe: it takes a consistent snapshot
# WITHOUT stopping the app (unlike a plain `cp`, which can copy a torn
# page mid-write). Restore with the SQLite CLI's `.restore` command.
#
# Requires the sqlite3 CLI on the host:  sudo apt-get install -y sqlite3
#
# What it does, per database:
#   1. `.backup` to <BACKUP_DIR>/<name>-YYYY-MM-DD.db (atomic: writes a
#      .partial first, renames on success).
#   2. Prunes to the newest ${RETAIN_DAYS} copies.
#
# Idempotent: a second run on the same day overwrites that day's file.
# Exit non-zero if ANY database fails to back up (so cron mail flags it).

set -euo pipefail

DATA_DIR="${RATER_DATA_DIR:-/opt/rater/data}"
BACKUP_DIR="${RATER_BACKUP_DIR:-/opt/rater/backups}"
RETAIN_DAYS="${RATER_BACKUP_RETAIN:-14}"
# The databases to back up (filenames under DATA_DIR, without .db).
DATABASES=("openrater")

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "backup-sqlite: sqlite3 CLI not found — run: sudo apt-get install -y sqlite3" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"
stamp="$(date +%F)"   # YYYY-MM-DD
rc=0

for name in "${DATABASES[@]}"; do
  src="${DATA_DIR}/${name}.db"
  if [ ! -f "${src}" ]; then
    echo "backup-sqlite: ${src} absent — skipping (not yet created?)."
    continue
  fi

  dest="${BACKUP_DIR}/${name}-${stamp}.db"
  tmp="${dest}.partial"
  # `.backup` uses the SQLite Online Backup API — consistent under WAL
  # while the app keeps writing. Single-quote the target so a path with
  # spaces would survive (defensive; our paths have none).
  if sqlite3 "${src}" ".backup '${tmp}'"; then
    mv -f "${tmp}" "${dest}"
    echo "backup-sqlite: wrote ${dest} ($(du -h "${dest}" | cut -f1))"
  else
    echo "backup-sqlite: FAILED to back up ${src}" >&2
    rm -f "${tmp}"
    rc=1
    continue
  fi

  # Retention: keep the newest ${RETAIN_DAYS}, delete older ones. `ls -t`
  # newest-first; tail skips the ones we keep; xargs -r no-ops on empty.
  ls -1t "${BACKUP_DIR}/${name}-"*.db 2>/dev/null \
    | tail -n "+$((RETAIN_DAYS + 1))" \
    | xargs -r rm -f
done

exit "${rc}"
