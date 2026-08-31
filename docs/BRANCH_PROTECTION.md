# Branch Protection Rules — `main`

This document describes the branch-protection rules that must be applied to
`main` in `github.com/mohamedhabibwork/storagekit`. Apply them once under
**Settings → Branches → Branch protection rules → Add rule → `main`**.

## Settings to enable

| Setting | Value | Why |
| --- | --- | --- |
| **Require a pull request before merging** | ON | Direct pushes to `main` are blocked. |
| **Require approvals** | `1` | At least one code owner must approve every PR. |
| **Dismiss stale pull request approvals when new commits are pushed** | ON | Re-review is forced when code changes. |
| **Require review from Code Owners** | ON | A CODEOWNERS-listed reviewer must approve the changed paths. |
| **Require status checks to pass before merging** | ON | All required checks must be green. |
| **Require branches to be up to date before merging** | ON | The PR re-runs against the latest `main`. |
| **Required status checks** | `required-checks / required` *(see below)* | The single gate that fans out to typecheck, unit tests, type tests and build. |
| **Require conversation resolution** | ON | All review comments must be resolved. |
| **Require signed commits** | optional | Recommended once the team is comfortable with it. |
| **Require linear history** | optional | Recommended (squash or rebase merge only). |
| **Include administrators** | ON | Admins are not exempt from these rules. |
| **Allow force pushes** | OFF | Never. |
| **Allow deletions** | OFF | Never. |
| **Block creation by non-fast-forwards** | already implied by the above | — |

## Required status check

The aggregator workflow is `.github/workflows/required-checks.yml`. Its single
job is named **`required`**, so the exact check GitHub must see is:

> **`required-checks / required`**

This check runs, in order: `npm ci` → `npm run typecheck` → `npm test` →
`npm run test:types` → `npm run build`. Until all of those pass, the PR cannot
merge.

> If you ever rename the job, update the "Required status checks" list in
> branch protection to match. Do **not** rely on individual step names —
> GitHub can rotate those and break the rule silently.

## Required reviewers

`.github/CODEOWNERS` makes `@mohamedhabibwork` the default owner for every
path, with explicit ownership for the publish workflow, public-API files,
README, `llms.txt` and `docs/`. Because **"Require review from Code Owners"**
is enabled, GitHub automatically requests a review from the matching owners
on every PR, and the PR cannot merge until they approve.

To add more owners, list their GitHub handles in `.github/CODEOWNERS`. The
last-matching rule wins, so put the most-specific patterns at the bottom.

## Merge rules summary

A PR to `main` is allowed to merge **only when all of**:

1. At least **1 approval** from a CODEOWNERS-listed owner.
2. The **`required-checks / required`** status check is green (and the branch
   is up to date with `main`).
3. All review conversations are resolved.
4. The PR template sections — Summary, Type of Change, Required Checks, and
   Release Notes (when `src/` or `package.json` is touched) — are filled in.

## Applying the rules

These rules must be applied via the GitHub web UI (or the
`gh api`/`mohamedhabibwork/storagekit` rulebook for org-level repos).
They are **not** committed to the repository — branch protection is a
repository setting, not a file.

> **Note for solo maintainers:** GitHub allows a personal account to require
> its own approval, but you must enable the **"Allow specified actors to
> bypass required pull requests"** checkbox (and not list yourself) to avoid
> being unable to merge solo work. The settings above already do the right
> thing — admins are subject to the rules.