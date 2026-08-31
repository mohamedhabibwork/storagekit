#!/usr/bin/env bash
#
# scripts/enable-private-vuln-reporting.sh
#
# Enables every "Code security and analysis" toggle this repo expects,
# with the correct endpoint per setting. Safe to re-run — each call is
# idempotent.
#
# Requires:
#   • gh 2.x+ (authenticated against github.com)
#   • admin role on github.com/mohamedhabibwork/storagekit
#
# Usage:
#   ./scripts/enable-private-vuln-reporting.sh
#
# Docs: docs/SECURITY.md §1, https://github.com/mohamedhabibwork/storagekit/settings/security_analysis

set -euo pipefail

REPO="${REPO:-mohamedhabibwork/storagekit}"
API_VERSION="2022-11-28"

# Bail early with a useful message if gh isn't installed or unauthenticated.
if ! command -v gh >/dev/null 2>&1; then
  echo "error: 'gh' (GitHub CLI) is not installed. Install it from https://cli.github.com/" >&2
  exit 127
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "error: 'gh' is not authenticated. Run 'gh auth login' first." >&2
  exit 1
fi

ADMIN_CHECK="$(gh api -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: ${API_VERSION}" \
  "/repos/${REPO}" \
  --jq '.permissions // {}')"

if ! printf '%s' "${ADMIN_CHECK}" | grep -q '"admin"[[:space:]]*:[[:space:]]*true'; then
  echo "error: the authenticated user does not have admin role on ${REPO}." >&2
  echo "       This script toggles repository-level security settings that require admin." >&2
  exit 2
fi

echo ">> Enabling security_and_analysis toggles on ${REPO} ..."

gh api -X PATCH \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: ${API_VERSION}" \
  "/repos/${REPO}" \
  --input - <<'JSON' >/dev/null
{
  "security_and_analysis": {
    "dependabot_security_updates":     { "enabled": true },
    "secret_scanning":                  { "enabled": true },
    "secret_scanning_push_protection":  { "enabled": true }
  }
}
JSON
echo "   ✓ Dependabot security updates, Secret scanning, Push protection"

echo ">> Enabling private vulnerability reporting ..."
gh api -X PUT \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: ${API_VERSION}" \
  "/repos/${REPO}/private-vulnerability-reporting" >/dev/null
echo "   ✓ Private vulnerability reporting"

echo
echo "Verifying ..."
gh api -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: ${API_VERSION}" \
  "/repos/${REPO}/private-vulnerability-reporting"

echo
echo "Done. Verify in the UI:"
echo "  https://github.com/${REPO}/settings/security_analysis"