# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Connector secret vault (E06) — encrypt connector API keys at rest.

The actuary types an API key in the Connector Studio; it's encrypted with the
server master key (``RATER_SECRETS_KEY``, a Fernet key) and stored as ciphertext
keyed by ``connector_id``. The plaintext key is decrypted ONLY at call time
(func:`get_secret`) — never echoed back to the UI, never written to a snapshot.

Fail-safe posture (the chosen "encrypted at rest" policy):

  * **Writes** (func:`set_secret`) RAISE :class:`SecretsVaultUnavailableError`
    when the master key is unset — a key is never persisted in the clear.
  * **Reads** (func:`get_secret`) degrade to ``None`` — a connector with no
    stored key (or an undecryptable row after a master-key rotation) simply
    falls back to its env var, so a missing/rotated key never crashes a call.

The vault is keyed by ``connector_id`` only (no FK to the manifests table), so a
key can be set for a *bundled* connector too — e.g. the shipped
``lightbox-structures`` becomes UI-configurable instead of env-var-only.
"""

from __future__ import annotations

import datetime as dt
import os
import sqlite3

from openrater.connectors.errors import SecretsVaultUnavailableError
from openrater.persistence.db import Database

_MASTER_KEY_ENV = "RATER_SECRETS_KEY"


def master_key_available() -> bool:
    """True when the server is configured to store secrets (master key present)."""
    return bool(os.environ.get(_MASTER_KEY_ENV))


def _fernet():
    """A Fernet bound to the server master key. Raises if the key is unset."""
    key = os.environ.get(_MASTER_KEY_ENV, "")
    if not key:
        raise SecretsVaultUnavailableError(
            "The API Lab secret vault is not configured. Set RATER_SECRETS_KEY "
            "(a Fernet key) on the API Lab backend to store connector API keys "
            "in-product, then retry.",
        )
    from cryptography.fernet import Fernet  # lazy — only imported when a key is used

    return Fernet(key.encode("ascii") if isinstance(key, str) else key)


def _now_iso() -> str:
    return dt.datetime.now(tz=dt.UTC).isoformat()


def set_secret(*, db: Database, connector_id: str, value: str, updated_by: str = "") -> None:
    """Encrypt + upsert the API key for a connector.

    Fail-safe: raises :class:`SecretsVaultUnavailableError` if the master key is
    unset, so a plaintext key is never written.
    """
    token = _fernet().encrypt(value.encode("utf-8")).decode("ascii")
    now = _now_iso()
    with db.connection() as conn:
        conn.execute(
            """
            INSERT INTO connector_secrets
                (connector_id, ciphertext, created_at, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(connector_id) DO UPDATE SET
                ciphertext = excluded.ciphertext,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by
            """,
            (connector_id, token, now, now, updated_by),
        )
        conn.commit()


def get_secret(*, db: Database, connector_id: str) -> str | None:
    """Decrypt + return the stored API key, or ``None``.

    Best-effort by design: returns ``None`` when there is no stored key, when the
    master key is unset, or when the ciphertext can't be decrypted (rotated/lost
    master key) — so the caller transparently falls back to the env var instead
    of crashing the connector call.
    """
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT ciphertext FROM connector_secrets WHERE connector_id = ?",
            (connector_id,),
        ).fetchone()
    if row is None:
        return None
    try:
        return _fernet().decrypt(row["ciphertext"].encode("ascii")).decode("utf-8")
    except Exception:  # noqa: BLE001 — master key unset/rotated or corrupt ciphertext
        return None


def has_secret(*, db: Database, connector_id: str) -> bool:
    """True if a ciphertext row exists (regardless of decryptability).

    Drives the "Key set ✓" UI without decrypting the value.
    """
    with db.connection() as conn:
        row = conn.execute(
            "SELECT 1 FROM connector_secrets WHERE connector_id = ?",
            (connector_id,),
        ).fetchone()
    return row is not None


def clear_secret(*, db: Database, connector_id: str) -> bool:
    """Delete the stored key. Returns True if a row was removed."""
    with db.connection() as conn:
        cur = conn.execute(
            "DELETE FROM connector_secrets WHERE connector_id = ?",
            (connector_id,),
        )
        conn.commit()
        return cur.rowcount > 0
