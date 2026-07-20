#!/usr/bin/env bash
# OpenRater — upgrade a demo box to the latest `main`. Run it from anywhere:
#
#     ~/openrater/deploy/upgrade.sh
#
# This replaces a fragile pull-and-restart recipe with explicit checks for two
# common failure modes:
#
#   1. Skipping `git pull`. Docker caches `COPY . .` when the build context is
#      unchanged, so `up --build` rebuilds nothing, restarts the SAME image,
#      and the site still serves the old app — behind a completely successful-
#      looking build log. The deploy "worked" and changed nothing.
#
#   2. `.env` drift. A newer compose file reads variables an older deploy/.env
#      has never heard of. Compose interpolates the WHOLE file before it starts
#      (or even profile-filters) anything, so one unknown key can kill the
#      deploy at PARSE time — even for a service you never run.
#
# So: pull first, prove what changed, refuse to run on a .env that would break
# or silently misconfigure the box, and then say plainly what was deployed.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

COMPOSE="deploy/docker-compose.yml"
ENV_FILE="deploy/.env"
ENV_EXAMPLE="deploy/.env.example"

bold() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
die() { printf '\n\033[31m✗ %s\033[0m\n\n' "$1" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "$ENV_FILE not found. Start from the example:
    cp $ENV_EXAMPLE $ENV_FILE
  then fill in the documented values in that file."

# ---------------------------------------------------------------------------
# 1. Pull. THE step whose omission silently redeploys the old app.
# ---------------------------------------------------------------------------
bold "Pulling the latest code"
before="$(git rev-parse --short HEAD)"
git pull --ff-only
after="$(git rev-parse --short HEAD)"

if [ "$before" = "$after" ]; then
  echo "  Already at $after — nothing new to deploy."
  echo "  (The rebuild below will be a cache hit. That is correct, not a bug.)"
else
  echo "  $before → $after"
  git --no-pager log --oneline "$before..$after" | sed 's/^/    /'
fi

# ---------------------------------------------------------------------------
# 2. Does this .env still satisfy the compose file it just pulled?
#
#    Three classes, read straight out of the compose file so this can never
#    drift from it:
#
#      ${VAR:?…}  REQUIRED  — compose ABORTS the deploy if unset or empty.
#      ${VAR}     CRITICAL  — no default: silently becomes "" (a box that
#                             builds and starts, but is broken — e.g. an SPA
#                             baked with an empty API base, or a tunnel with
#                             no token).
#      ${VAR:-…}  OPTIONAL  — compose supplies a default; absent is fine.
#
#    `$${VAR}` is an ESCAPED reference (compose passes it through to the
#    container's shell) — NOT an interpolation — so strip those first or they
#    read as CRITICAL. Whole-line comments are stripped for the same reason.
# ---------------------------------------------------------------------------
bold "Checking $ENV_FILE against the compose file"

# NOTE: newline-delimited strings, NOT bash arrays. Under `set -u`, expanding
# an EMPTY array (`"${REQUIRED[@]}"`) is an unbound-variable error on bash < 4.4
# — and REQUIRED is empty by design now (no `:?` vars survive the CI guard), so
# arrays would crash this script on every run on an older shell. A preflight
# that dies (or worse, vacuously passes) is worse than no preflight.
scan="$(grep -vE '^[[:space:]]*#' "$COMPOSE" | sed -E 's/\$\$\{[A-Z_][A-Z0-9_]*\}//g')"
list() { printf '%s\n' "$scan" | grep -oE "$1" | grep -oE '[A-Z_][A-Z0-9_]*' | sort -u; }

required_vars="$(list '\$\{[A-Z_][A-Z0-9_]*:\?' || true)"   # aborts the deploy
critical_vars="$(list '\$\{[A-Z_][A-Z0-9_]*\}'  || true)"   # silently breaks the box
optional_vars="$(list '\$\{[A-Z_][A-Z0-9_]*:-'  || true)"   # compose has a default

# The value as compose will see it: absent and blank are the same thing.
value_of() {
  grep -E "^[[:space:]]*${1}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]]*//; s/[[:space:]]*$//; s/^"(.*)"$/\1/'
}

blocking=""
for v in $(printf '%s\n%s\n' "$required_vars" "$critical_vars"); do
  [ -z "$(value_of "$v")" ] && blocking="$blocking $v"
done

if [ -n "$blocking" ]; then
  printf '\n\033[31m✗ %s is missing (or blank for) value(s) this compose file needs:\033[0m\n\n' \
    "$ENV_FILE" >&2
  for v in $blocking; do
    hint="$(grep -E "^${v}=" "$ENV_EXAMPLE" | head -1 || true)"
    printf '      %-28s %s\n' "$v" "${hint:+(example: $hint)}" >&2
  done
  cat >&2 <<WHY

  Compose reads the whole file before it starts anything, so one of these can
  kill the deploy at parse time — or, worse, build a box that starts and is
  quietly broken (an SPA baked with an empty API base, a tunnel with no token).
  Set them in $ENV_FILE (see the comments in $ENV_EXAMPLE), then re-run this
  script.

WHY
  exit 1
fi

# Optional keys this .env has never heard of: worth knowing about, never worth
# blocking a deploy over — compose's own default applies and nothing is broken.
new_optional=""
for v in $optional_vars; do
  grep -qE "^[[:space:]]*${v}=" "$ENV_FILE" || new_optional="$new_optional $v"
done

echo "  Required + critical values: all present."
if [ -n "$new_optional" ]; then
  echo "  New optional key(s) since this box was set up — compose defaults apply,"
  echo "  nothing is broken. Add them to $ENV_FILE only to turn the feature on:"
  for v in $new_optional; do printf '      %s\n' "$v"; done
fi

# ---------------------------------------------------------------------------
# 3. Build, sweep the data, THEN restart.
#
#    The integrity sweep runs with the NEWLY BUILT image
#    against the live DB, read-only, BEFORE the restart triggers this
#    release's migrations — a box with dangling references refuses the
#    upgrade with the rows named instead of failing mid-migration.
#    --missing-ok keeps a fresh box (no DB yet) deployable.
# ---------------------------------------------------------------------------
bold "Building"
echo "  (a real code change takes minutes here — a cache hit takes seconds)"
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" build

bold "Pre-flight: data integrity sweep (read-only)"
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" run --rm --no-deps app \
  python -m openrater.persistence check --db /data/openrater.db --missing-ok \
  || die "Integrity sweep failed — fix the rows it named (the DB was NOT
  modified and the old containers are still serving), then re-run this script."

bold "Restarting"
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" up -d

# ---------------------------------------------------------------------------
# 4. Say what actually happened.
# ---------------------------------------------------------------------------
bold "Container state"
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" ps

bold "Deployed"
echo "  Commit:  $(git rev-parse --short HEAD) — $(git --no-pager log -1 --format=%s | cut -c1-60)"
echo "  Serving: $(value_of PUBLIC_URL)"
echo
echo "  Still looks old in the browser? Hard-refresh (Cmd/Ctrl+Shift+R), then"
echo "  purge the edge: Cloudflare → Caching → Configuration → Purge Everything."
echo
