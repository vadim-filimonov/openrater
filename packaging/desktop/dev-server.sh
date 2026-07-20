#!/bin/sh
# Dev stand-in for the packaged server binary — SAME env contract as
# the PyInstaller build (see services/mcp/src/runtime.ts): no args;
# reads RATER_PORT (+ RATER_DB_PATH / RATER_SCORING_URL / ... from
# the environment the supervisor sets). P3.2's desktop entrypoint
# replaces the uvicorn target here with the overlay app (SPA + seed).
set -e
cd "$(dirname "$0")/../../server"
PYTHONPATH=src exec .venv/bin/python -m uvicorn openrater.main:app \
  --host 127.0.0.1 --port "${RATER_PORT:?RATER_PORT not set}" --log-level warning
