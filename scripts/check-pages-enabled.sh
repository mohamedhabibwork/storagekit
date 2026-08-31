#!/usr/bin/env bash
#
# scripts/check-pages-enabled.sh
#
# Reports whether GitHub Pages is enabled on the repo, and what its
# build/deploy source is set to. Useful when the `docs` workflow fails
# with the 404 from `actions/deploy-pages` — that error means Pages has
# not been initialized yet under Settings → Pages.
#
# Requires:
#   • gh 2.x+ (authenticated against github.com)
#   • admin role on github.com/mohamedhabibwork/storagekit
#
# Usage:
#   ./scripts/check-pages-enabled.sh

set -euo pipefail

REPO="${REPO:-mohamedhabibwork/storagekit}"
API_VERSION="2022-11-28"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: 'gh' is not installed. Install it from https://cli.github.com/" >&2
  exit 127
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "error: 'gh' is not authenticated. Run 'gh auth login' first." >&2
  exit 1
fi

# `GET /repos/{owner}/{repo}/pages` returns 404 if Pages has not been
# initialized, 200 with the source config once it has. The action's
# "Failed to create deployment (status: 404)" error in the docs
# workflow is the runtime symptom of this 404.
http_code="$(gh api \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: ${API_VERSION}" \
  -o /tmp/pages-$$.json \
  -w '%{http_code}' \
  "/repos/${REPO}/pages" || true)"

echo "GET /repos/${REPO}/pages -> HTTP ${http_code}"
echo

case "${http_code}" in
  200)
    jq '.' /tmp/pages-$$.json
    echo
    src="$(jq -r '.build_type // .source // "unknown"' /tmp/pages-$$.json)"
    echo "Pages is enabled. Build source: ${src}"
    if [ "${src}" != "workflow" ]; then
      echo
      echo "⚠️  Source is not 'workflow'. The docs workflow deploys via"
      echo "   actions/deploy-pages, which only works when Source = GitHub Actions."
      echo "   Fix at: https://github.com/${REPO}/settings/pages"
    fi
    ;;
  404)
    echo "❌ Pages is NOT enabled on ${REPO}."
    echo
    echo "Fix: as a repo admin, open"
    echo "  https://github.com/${REPO}/settings/pages"
    echo "and set:"
    echo "  Build and deployment → Source → GitHub Actions"
    echo
    echo "Then re-run the 'docs' workflow (or push a docs change)."
    ;;
  *)
    echo "Unexpected response — see /tmp/pages-$$.json" >&2
    exit 3
    ;;
esac

rm -f /tmp/pages-$$.json