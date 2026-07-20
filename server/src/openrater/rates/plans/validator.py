# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
"""Plan validator — full reachability/ordering checks beyond shape.

`author.validate_plan` runs:

  1. **Unknown stage reference**: any `stages.X.Y` path resolves to
     a stage that exists in the plan.
  2. **Forward / self reference**: the referenced stage runs BEFORE
     the referencer in `sequence` (no forward edges, no self-edges).
  3. **Undeclared output reference**: the referenced field `Y` is in
     the referenced stage's `StageOutput` list (so the Engine actually
     produces that key at runtime).

The reference collector is a pure function on the config_json blob —
no DB access, no plan context — so it's easy to unit-test in isolation.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class StageReference:
    """One `stages.X.Y` reference found inside a config_json blob.

    `json_path` is a dotted pointer from the config_json root to the
    string that contained the reference.
    """

    stage_id: str
    field: str
    json_path: str


def collect_stage_references(
    config_json: Any,
    *,
    json_path_prefix: str = "",
) -> Iterator[StageReference]:
    """Walk a config_json blob and yield every `stages.X.Y` reference.

    Recursive: dicts, lists, and tuples are traversed; primitives that
    aren't strings are skipped. String values are matched against the
    `stages.<id>.<field>` shape.
    """
    if isinstance(config_json, str):
        if not config_json.startswith("stages."):
            return
        parts = config_json.split(".", 2)
        if len(parts) != 3 or not parts[1] or not parts[2]:
            return
        stage_id = parts[1]
        field = parts[2].split(".", 1)[0]
        if not stage_id or not field:
            return
        yield StageReference(
            stage_id=stage_id,
            field=field,
            json_path=json_path_prefix,
        )
        return

    if isinstance(config_json, dict):
        for key, value in config_json.items():
            child_prefix = f"{json_path_prefix}.{key}" if json_path_prefix else str(key)
            yield from collect_stage_references(value, json_path_prefix=child_prefix)
        return

    if isinstance(config_json, list | tuple):
        for idx, item in enumerate(config_json):
            child_prefix = f"{json_path_prefix}[{idx}]" if json_path_prefix else f"[{idx}]"
            yield from collect_stage_references(item, json_path_prefix=child_prefix)
        return

    return


# ===========================================================================
# Cross-stage validation — invoked by author.validate_plan
# ===========================================================================


@dataclass(frozen=True)
class StageMeta:
    """Slim per-stage metadata the cross-stage validator needs."""

    stage_id: str
    sequence: int
    declared_outputs: frozenset[str]


def _check_one_reference(
    *,
    ref: StageReference,
    referencer: StageMeta,
    by_id: dict[str, StageMeta],
) -> tuple[str, str] | None:
    """Validate a single `stages.X.Y` reference. Returns (code, message) on error."""
    target = by_id.get(ref.stage_id)
    if target is None:
        return (
            "unknown_stage_reference",
            (
                f"Path 'stages.{ref.stage_id}.{ref.field}' references stage "
                f"{ref.stage_id!r} which doesn't exist in this plan; "
                f"known stage_ids: {sorted(by_id)}"
            ),
        )
    if target.stage_id == referencer.stage_id:
        return (
            "self_reference",
            (
                f"Stage {referencer.stage_id!r} references its own output "
                f"'stages.{ref.stage_id}.{ref.field}'; a stage can't read "
                f"its own output (it doesn't exist yet)"
            ),
        )
    if target.sequence >= referencer.sequence:
        return (
            "forward_reference",
            (
                f"Path 'stages.{ref.stage_id}.{ref.field}' is a FORWARD "
                f"reference — stage {ref.stage_id!r} runs at sequence "
                f"{target.sequence}, AFTER the referencer "
                f"{referencer.stage_id!r} at sequence {referencer.sequence}. "
                f"Stages can only read outputs of stages that run BEFORE them."
            ),
        )
    if ref.field not in target.declared_outputs:
        return (
            "undeclared_output_reference",
            (
                f"Stage {ref.stage_id!r} doesn't declare output {ref.field!r}; "
                f"declared outputs: {sorted(target.declared_outputs)}. "
                f"Either add {ref.field!r} to the stage's outputs or change "
                f"this reference to a declared one."
            ),
        )
    return None


__all__ = [
    "StageMeta",
    "StageReference",
    "_check_one_reference",
    "collect_stage_references",
]
