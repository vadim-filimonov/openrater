#!/usr/bin/env bash
# Copyright 2026 Vadim Filimonov and the OpenRater contributors
# SPDX-License-Identifier: Apache-2.0
#
# Public-repository hygiene gates, runnable locally and in CI:
#
#   1. BRAND gate    — zero legacy-brand strings in tracked files.
#   2. CONTENT gate  — zero known bureau-derived fixture fingerprints.
#   3. PUBLIC-SURFACE gate — zero internal project-management breadcrumbs.
#   4. PROVENANCE gate — every data file in docs/fixtures/ is named in
#      the provenance manifest.
#
# The content exceptions are guards whose job is to name what they forbid.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

fail=0

CONTENT_EXCLUDE=(
  ":(exclude,glob)scripts/ci/hygiene_gates.sh"
  ":(exclude,glob)scripts/check-rating-lob-agnostic.mjs"
  ":(exclude,glob)server/tests/test_ingest_build.py"
  ":(exclude,glob)server/uv.lock"
  ":(exclude,glob)frontend/public/geo/**"
  ":(exclude,glob)server/src/openrater/rates/ingest/assets/geo-universe.json"
  ":(exclude,glob)**/nonprofit_990_2000_policies.csv"
)

echo "── gate 1/4: legacy identity"
# Keep the retired name out of the repository while still checking for it.
LEGACY_BRAND="$(printf '%s%s' 'ko' 'da')"
if git grep -Iil "$LEGACY_BRAND" -- . >/tmp/gate_brand.txt 2>/dev/null; then
  echo "FAIL — legacy brand strings in:"; cat /tmp/gate_brand.txt; fail=1
else
  echo "ok — 0 files"
fi

echo "── gate 2/4: synthetic content"
CONTENT_PATTERN='iso[ _-]bop|sursafe|cincinnati|BMUT-[0-9]|BP [0-9]{2} [0-9]{2}|ISO Rule 23|53983|09011|09015|09033|09036|62106|71641|73210|73911|73912|91342|bceg_grade|bceg_1|ppc_class|Pioneer (credit|discount|program)|1\.401|0\.389|1\.504|1\.518|0\.938|0\.888|0\.921|1\.028'
if git grep -IilE "$CONTENT_PATTERN" -- . "${CONTENT_EXCLUDE[@]}" >/tmp/gate_content.txt 2>/dev/null; then
  echo "FAIL — legacy rating-data fingerprints in:"; cat /tmp/gate_content.txt; fail=1
else
  echo "ok — 0 files"
fi

echo "── gate 3/4: public surface"
INTERNAL_PATTERN='portfolio-redesign|book-intake|drift-honesty|mvp-tightness|MVP-[0-9]+|first-run-experience|walk-caught|owner-approved|Sweep Walk|D14 certificates'
if git grep -IilE "$INTERNAL_PATTERN" -- . ":(exclude,glob)scripts/ci/hygiene_gates.sh" >/tmp/gate_internal.txt 2>/dev/null; then
  echo "FAIL — internal project breadcrumbs in:"; cat /tmp/gate_internal.txt; fail=1
else
  echo "ok — 0 files"
fi

echo "── gate 4/4: fixture provenance"
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
