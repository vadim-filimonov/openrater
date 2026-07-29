#!/usr/bin/env bash
# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
#
# The repo hygiene gates (Detachment Brief §6.1–6.2), runnable locally
# and in CI:
#
#   1. BRAND gate    — zero legacy-brand strings in tracked files.
#   2. CONTENT gate  — zero bureau-derived fixture names.
#   3. PROVENANCE gate — every data file in docs/fixtures/ is named in
#      the provenance manifest.
#
# Exceptions are files whose JOB is to name the forbidden literals:
# the founding/historical docs (they describe the detachment), NOTICE
# (provenance line), this script, and the two guards that enforce
# LOB-agnosticism by naming what they forbid.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

fail=0

EXCLUDE=(
  ":(exclude)docs/OSS_DETACHMENT_STRATEGY.md"
  ":(exclude)docs/OSS_DETACHMENT_RESEARCH_APPENDIX.md"
  ":(exclude)docs/DETACHMENT_BRIEF.md"
  ":(exclude)docs/BRIEF_2_OPENRATER_FOR_CLAUDE.md"
  ":(exclude)NOTICE"
  ":(exclude)scripts/ci/hygiene_gates.sh"
  ":(exclude)scripts/check-rating-lob-agnostic.mjs"
  ":(exclude)server/tests/test_ingest_build.py"
)

echo "── gate 1/3: brand (koda)"
if git grep -Iil "koda" -- . "${EXCLUDE[@]}" >/tmp/gate_brand.txt 2>/dev/null; then
  echo "FAIL — legacy brand strings in:"; cat /tmp/gate_brand.txt; fail=1
else
  echo "ok — 0 files"
fi

echo "── gate 2/3: content (bureau-derived fixture names)"
if git grep -IilE "iso[-_]bop|sursafe|ISO_BOP|cincinnati" -- . "${EXCLUDE[@]}" ":(exclude)packages/class-vocab" >/tmp/gate_content.txt 2>/dev/null; then
  echo "FAIL — bureau-derived fixture names in:"; cat /tmp/gate_content.txt; fail=1
else
  echo "ok — 0 files"
fi
# (packages/class-vocab keeps NOMINATIVE vocabulary ids — naming the
# real-world coding standards, like NAICS — with invented sample rows.)

echo "── gate 3/3: fixture provenance"
manifest="docs/fixtures/FIXTURE_PROVENANCE.md"
missing=0
while IFS= read -r f; do
  base="$(basename "$f")"
  if ! grep -q "$base" "$manifest"; then
    echo "FAIL — $f has no entry in $manifest"; missing=1
  fi
done < <(git ls-files "docs/fixtures/*.json" "docs/fixtures/*.csv" "docs/fixtures/*.xlsx")
if [ "$missing" -eq 0 ]; then echo "ok — every fixture is in the manifest"; else fail=1; fi

if [ "$fail" -ne 0 ]; then
  echo; echo "Hygiene gates FAILED — see above."; exit 1
fi
echo; echo "All hygiene gates pass."
