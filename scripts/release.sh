#!/usr/bin/env bash
# Weekly versioning release for this repo.
#   Last release in the same ISO week -> patch (0.2.0 -> 0.2.1)
#   Last release in an earlier week   -> minor (0.2.x -> 0.3.0)
#
# Usage:
#   scripts/release.sh plan      # show the next version, change nothing
#   scripts/release.sh publish   # check, bump, push, npm publish, GitHub release
set -euo pipefail

cd "$(dirname "$0")/.."
name=$(node -p "require('./package.json').name")

iso_week() { date -j -f "%Y-%m-%d" "$1" "+%G-%V" 2>/dev/null || date -d "$1" "+%G-%V"; }

last_tag=$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)
bump=minor
if [[ -n "$last_tag" ]]; then
  last_date=$(git log -1 --format=%cs "$last_tag")
  [[ "$(iso_week "$last_date")" == "$(iso_week "$(date +%F)")" ]] && bump=patch
fi
echo "== $name: $(node -p "require('./package.json').version") -> $bump"

case "${1:-}" in
  plan) exit 0 ;;
  publish) ;;
  *) echo "Usage: $0 {plan|publish}" >&2; exit 1 ;;
esac

if [[ -n "$last_tag" && -z "$(git log --oneline "$last_tag"..HEAD)" ]]; then
  echo "  nothing new since $last_tag; skipping"
  exit 0
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "  uncommitted changes; commit them first" >&2
  exit 1
fi

git pull -q --rebase origin main
npm run -s check
npm version "$bump" -m "chore: release v%s"
git push -q origin main
tag="v$(node -p "require('./package.json').version")"
git push -q origin "$tag"
npm publish --access public --provenance=false
gh release create "$tag" --title "$tag" --generate-notes --verify-tag
