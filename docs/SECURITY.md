# Security setup — settings GitHub will not let us commit

`SECURITY.md` describes **how to report** vulnerabilities. This document
describes **how the repository is hardened** at the GitHub-level so the
report actually reaches a fix.

Some security features are repository **settings** and cannot live in a
file. They must be turned on once via the web UI (or `gh api`).

## 1. Required one-time setup (Settings → Code security and analysis)

Open: `https://github.com/mohamedhabibwork/storagekit/settings/security_analysis`

| Feature | Recommended setting |
| --- | --- |
| **Dependency graph** | Enabled (default). |
| **Dependabot alerts** | **Enabled** — required for the security workflow below to open PRs against new advisories. |
| **Dependabot security updates** | **Enabled** — Dependabot will open PRs that close any open GHSAs affecting this repo. |
| **Dependabot version updates** | Enabled — already wired via `.github/dependabot.yml`. |
| **Code scanning** | **Enabled** — required so the alerts from `.github/workflows/codeql.yml` actually surface under the Security tab. Default setup is fine; the workflow here uploads SARIF to the default database. |
| **Secret scanning** | **Enabled** — GitHub will flag accidentally committed tokens / cloud keys. |
| **Push protection** | **Enabled** — blocks pushes that contain a known secret pattern. Strongly recommended for any published library. |
| **Private vulnerability reporting** | **Enabled** — this is what powers the "Report a vulnerability" button linked from `SECURITY.md`. |

CLI equivalent (run from a checkout with admin scope):

```bash
gh api -X PATCH \
  -H "Accept: application/vnd.github+json" \
  /repos/mohamedhabibwork/storagekit \
  --input - <<'JSON'
{
  "security_and_analysis": {
    "dependabot_security_updates": { "enabled": true },
    "secret_scanning":              { "enabled": true },
    "secret_scanning_push_protection": { "enabled": true },
    "private_vulnerability_reporting": { "enabled": true }
  }
}
JSON
```

`dependency_graph`, `dependabot_alerts`, `advanced_security` and
`code_scanning` are toggled on a different endpoint and GitHub sometimes
defaults them to on — check the settings page to be sure.

## 2. Required CI (already in this repo)

- **`.github/workflows/codeql.yml`** — runs CodeQL with the
  `security-extended` query pack on every push to `main`, every PR, and
  weekly. Findings appear under **Security → Code scanning alerts**.
- **`.github/dependabot.yml`** — version + security updates.
  Security-update PRs bypass the `minor-and-patch` group so they open
  immediately. Triage like any other PR; merge once CI is green.
- **`.github/workflows/required-checks.yml`** — the gate that
  branch-protection points at, so a security regression cannot merge even
  if CodeQL misses it.

## 3. Required branch-protection linkage

Add `CodeQL / Analyze (typescript)` to the list of **Required status
checks** on `main` (alongside `required-checks / required`). That way a new
CodeQL alert that introduces a regression will block the merge, not just
be a yellow badge.

The exact branch-protection settings table is in
[`docs/BRANCH_PROTECTION.md`](BRANCH_PROTECTION.md).

## 4. Triage loop

When a CodeQL or Dependabot alert opens:

1. Triage it under **Security → Code/Dependabot alerts**.
2. If real: either fix in a PR, or open a private GitHub Security Advisory
   if the fix is non-trivial and needs coordinated disclosure.
3. If a false positive: dismiss with a short reason. Dismissed alerts
   remain auditable.
4. If an alert is on a dependency we don't ship directly: mark
   "Automated security fix" or pin a patched transitive range.

## 5. When in doubt

Read [`SECURITY.md`](../SECURITY.md) (top-level) — that's the page external
researchers and Dependabot see.