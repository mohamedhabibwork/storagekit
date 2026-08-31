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

**Compatibility note:** `mkdocs-material<9.7.0` declares
`pymdown-extensions~=10.2`, which is incompatible with
`pymdown-extensions 11.x`. If you bump `pymdown-extensions` past 10.2,
bump `mkdocs-material` to `>=9.7.0` in the same PR — otherwise the
`pip install` step in `docs.yml` will fail with `ResolutionImpossible`.

## One-time GitHub setting

Pages must be **initialized** on the repo exactly once, by an admin,
before the workflow can deploy anything. The flow:

1. Open `https://github.com/mohamedhabibwork/storagekit/settings/pages`.
2. Under **Build and deployment**, set **Source** = **GitHub Actions**.
3. Save. GitHub provisions the Pages site for the repo — this is the
   step the workflow cannot perform for you.
4. Re-run the `docs` workflow (or push a doc change). The first deploy
   will then succeed.

### How this fails when it isn't done

`actions/deploy-pages@v5` returns **HTTP 404** on its `createPagesDeployment`
call if the repo doesn't have a Pages site yet. The error in the workflow
log looks like this — it is the expected signal, not a code bug:

```
Error: Creating Pages deployment failed
Error: HttpError: Not Found
    at createPagesDeployment (…/api-client.js:125:1)
Error: Error: Failed to create deployment (status: 404) with build version
<hash>. Request ID … Ensure GitHub Pages has been enabled:
https://github.com/mohamedhabibwork/storagekit/settings/pages
```

> The `[DEP0040] punycode` deprecation warning in the same log is from
> Node 22 itself, not from this repo. It does not affect the deploy and
> is fixed by GitHub's runners in due course.

### Verify Pages is enabled from the terminal

A `scripts/check-pages-enabled.sh` helper ships with the repo — it
hits the Pages API and reports the current source so you can confirm
the setting without opening the web UI.

## Optional customizations (left for later)

- Drop a real logo at `docs/assets/logo.png` and a favicon at
  `docs/assets/favicon.png` and uncomment the `theme.logo` /
  `theme.favicon` lines in `mkdocs.yml`.
- Switch `site_url` to a custom domain and add a `CNAME` file in
  `docs/assets/`.
- Add the Mermaid diagram plugin (already declared under `pymdownx
  .superfences` but commented in the workflow — just add
  `mkdocs-material[imaging]` to `requirements-docs.txt`).