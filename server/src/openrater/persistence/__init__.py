# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""openrater.persistence — DB session + migration runner.

Two modules:
  · db        — `Database` class: SQLite connection factory + idempotent
                migration runner that applies every `NNN_*.sql` file in
                `migrations/` exactly once.
  · dialect   — SQL dialect abstraction (SQLite today, Postgres later).
                Ported verbatim from the original prototype; pure stdlib + no other
                openrater dependencies.
"""

from openrater.persistence.db import Database, MigrationError
from openrater.persistence.dialect import Dialect, DialectKind, SqliteDialect

__all__ = [
    "Database",
    "MigrationError",
    "Dialect",
    "DialectKind",
    "SqliteDialect",
]
