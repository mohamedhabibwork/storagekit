# docs/SITE.md — about the rendered docs site

> This file is **not** part of the MkDocs navigation (see
> `mkdocs.yml` → `nav:`). It exists in `docs/` only so it ships in the
> repo for maintainers — it will never appear on the live site.

## What is this?

The `docs/` folder is rendered by **MkDocs + Material** into a static
site, deployed to GitHub Pages on every push to `main`.

| Thing | Where |
| --- | --- |
| Live URL | `https://mohamedhabibwork.github.io/storagekit/` |
| Site config | `mkdocs.yml` (repo root) |
| Source pages | `docs/*.md` |
| Build workflow | `.github/workflows/docs.yml` |
| Pinned dependencies | `requirements-docs.txt` |
| Generated output (gitignored) | `site/` |

The `README.md` is the single source of truth for the npm package
description, install instructions, and the API walk-through. The site is
**not** a copy of the README — it is the per-driver reference plus a
short landing page (`docs/index.md`).

## Previewing locally

```bash
# one-time
python3 -m venv .venv-docs
source .venv-docs/bin/activate
pip install -r requirements-docs.txt

# live-reload preview at http://127.0.0.1:8000/
mkdocs serve --strict
```

`--strict` matches CI: it fails the build on any broken link, missing
nav target, or warning. Use `mkdocs build --strict --clean` to verify
exactly what CI sees.

## Adding a new page

1. Drop the markdown file in `docs/` — e.g. `docs/driver-x.md`.
2. Add it to the `nav:` block in `mkdocs.yml`. MkDocs will not auto-pick
   files that are not in `nav:` (the `validation.nav.omitted_files:
   ignore` setting is what stops it from erroring on `SITE.md`,
   `BRANCH_PROTECTION.md` isn't shipped… only what you list in `nav:`
   actually appears).
3. Open the PR. The docs workflow builds with `--strict`, so a bad link
   fails the PR instead of breaking the site.

## Bumping pinned versions

Edit `requirements-docs.txt` (pinned with `==` to keep builds
reproducible), then open a PR. The cache key in `docs.yml` is keyed off
the hash of this file, so a version bump invalidates the pip cache
automatically.

## One-time GitHub setting

The Pages source must be set to **GitHub Actions** once, by an admin,
under:

> `https://github.com/mohamedhabibwork/storagekit/settings/pages`
> → **Build and deployment** → **Source** = **GitHub Actions**

Without this, the `actions/deploy-pages` step will fail with a clear
"Pages is not configured" error.

## Optional customizations (left for later)

- Drop a real logo at `docs/assets/logo.png` and a favicon at
  `docs/assets/favicon.png` and uncomment the `theme.logo` /
  `theme.favicon` lines in `mkdocs.yml`.
- Switch `site_url` to a custom domain and add a `CNAME` file in
  `docs/assets/`.
- Add the Mermaid diagram plugin (already declared under `pymdownx
  .superfences` but commented in the workflow — just add
  `mkdocs-material[imaging]` to `requirements-docs.txt`).