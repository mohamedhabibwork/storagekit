#!/usr/bin/env bash
# Toggle GitHub Actions (CI/CD) for this repo.
#
# Usage: scripts/ci.sh {enable|disable|status}
set -euo pipefail

cd "$(dirname "$0")/.."
command -v gh >/dev/null || { echo "gh CLI is required" >&2; exit 1; }
full=$(gh repo view --json nameWithOwner -q .nameWithOwner)

enable_repo() {
  gh api -X PUT "repos/$full/actions/permissions" -F enabled=true >/dev/null
  # Re-enable workflows that were disabled individually.
  gh workflow list -R "$full" --all --json id,state \
    -q '.[] | select(.state == "disabled_manually") | .id' |
    while read -r id; do
      gh workflow enable "$id" -R "$full" >/dev/null 2>&1 || true
    done
}

disable_repo() {
  # Cancel anything in flight before switching Actions off.
  for status in in_progress queued; do
    gh run list -R "$full" --status "$status" --json databaseId -q '.[].databaseId' |
      while read -r id; do
        gh run cancel "$id" -R "$full" >/dev/null 2>&1 || true
      done
  done
  gh api -X PUT "repos/$full/actions/permissions" -F enabled=false >/dev/null
}

case "${1:-}" in
  enable) enable_repo ;;
  disable) disable_repo ;;
  status) ;;
  *) echo "Usage: $0 {enable|disable|status}" >&2; exit 1 ;;
esac

enabled=$(gh api "repos/$full/actions/permissions" -q .enabled)
printf '%-12s %s\n' "${full#*/}" "$([[ "$enabled" == "true" ]] && echo enabled || echo disabled)"
