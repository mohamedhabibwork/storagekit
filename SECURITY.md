# Security Policy

> **TL;DR** — please report security issues privately via **GitHub
> → Security → Report a vulnerability** (see step 2 below). Do **not** open
> a public issue.

Thank you for helping keep `@mohamedhabibwork/storagekit` and its users safe.
This document explains which versions are supported, how to report a
vulnerability, and how we handle it.

> The "Report a vulnerability" button in step 2 is powered by GitHub's
> **Private vulnerability reporting** setting. If you can see a public
> `Issues` tab but no "Report a vulnerability" button, the setting is
> off — see [`docs/SECURITY.md`](docs/SECURITY.md) §1 for how the
> maintainer enables it.

## 1. Supported Versions

Only the latest released version on the `main` branch receives security
fixes. Older lines may receive patches on a best-effort basis if the
maintainer has the bandwidth.

| Version line | Supported |
| --- | --- |
| `0.2.x` (latest) | ✅ |
| `0.1.x` | ⚠️ Critical fixes only, until 6 months after `0.2.0` release |
| `< 0.1` | ❌ No longer supported |

The published version is `npm view @mohamedhabibwork/storagekit version` or
<https://github.com/mohamedhabibwork/storagekit/releases>.

## 2. Reporting a Vulnerability

**Please do not file a public GitHub issue for security bugs.** Use one of
these private channels instead — in order of preference:

1. **GitHub private vulnerability reporting** — the recommended path:
   <https://github.com/mohamedhabibwork/storagekit/security/advisories/new>
   (also reachable from the **Security** tab → **Advisories** →
   **Report a vulnerability**).
2. **Email** — `mohamedhabibwork@gmail.com` (PGP key on request).

Please include:

- A clear description of the issue and the impact (what an attacker can do).
- The exact version(s) and runtime affected (`node -v`, `bun --version`,
  `deno --version`).
- A minimal reproduction (snippet, command, or failing test).
- Whether you believe the issue is already known or public.

## 3. Response Targets

We follow a coordinated-disclosure-style process:

| Stage | Target |
| --- | --- |
| Initial acknowledgment | within **3 business days** |
| Triage + severity rating (CVSS-style) | within **7 business days** |
| Patch released for supported versions | within **30 days** of triage |
| Public advisory (GitHub Security Advisory) | at the same time as the patch |

If we cannot meet these targets for a specific issue we will tell you why
and propose a new date.

## 4. Disclosure Process

1. Reporter opens a **draft** GitHub Security Advisory (or emails
   privately).
2. Maintainer triages, agrees on a fix window, and collaborates privately
   on a patch + regression test.
3. Maintainer merges the patch and publishes the version.
4. Maintainer publishes the GitHub Security Advisory the same day, which:
   - credits the reporter (if they wish to be credited),
   - describes the impact and affected versions,
   - links to the fix commit and patched release.
5. We may request a CVE via GitHub's automated CNA process when the
   advisory is published.

## 5. Out-of-Scope Issues

These are **not** security vulnerabilities and should be filed as normal
[bug reports](https://github.com/mohamedhabibwork/storagekit/issues/new/choose):

- Reports against an unsupported version (see §1).
- "The package is missing feature X" — use a feature request.
- Reports about a downstream consumer's misconfiguration (e.g. a public
  S3 bucket the user themselves misconfigured).
- Theoretical issues with no demonstrated impact on this codebase.
- Issues in upstream dependencies that we have not yet patched; please
  still tell us, but they are tracked via Dependabot rather than here.

## 6. Hardening & Detection

This repository also runs:

- **GitHub Dependabot** — version + security updates (`/security/dependabot`).
- **GitHub Code Scanning (CodeQL)** — static analysis on every push and PR
  to `main` (`/security/code-scanning`).
- **Branch protection** — see [`docs/BRANCH_PROTECTION.md`](docs/BRANCH_PROTECTION.md).

If you spot anything else we should be doing here, please open an issue.

— Mohamed Habib · `@mohamedhabibwork/storagekit` maintainer