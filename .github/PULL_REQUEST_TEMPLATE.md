<!--
Thanks for opening a PR against @mohamedhabibwork/storagekit!
This template is required. Fill in every section — incomplete PRs will be auto-closed.

Rules:
  • PRs to `main` require at least 1 approval from a code owner
    (see `.github/CODEOWNERS`). Default owner is @mohamedhabibwork.
  • All CI checks must be green before merge (see "Required Checks" below).
  • PRs that touch `src/`, `package.json`, or `*.ts` MUST include a changeset
    note in the "Release Notes" section.
  • PRs that change public API MUST update `README.md` / `docs/` in the same PR.
-->

## Summary
<!-- One or two sentences. What does this PR change and why? -->

## Related Issue
<!-- Link the issue this PR closes or relates to: Closes #123, Fixes #456. -->

## Type of Change
<!-- Check all that apply. -->
- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update
- [ ] Refactor / chore (no functional change)
- [ ] Test improvement

## Drivers Touched
<!-- Leave blank if none. -->
- [ ] Local
- [ ] S3 / AWS
- [ ] MinIO
- [ ] Azure Blob
- [ ] Oracle OCI Object Storage
- [ ] Core / shared

## Required Checks
<!-- Confirm locally before requesting review. CI must pass on the PR. -->
- [ ] `npm test` passes locally
- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes (if configured)
- [ ] New or changed code has tests
- [ ] No new TypeScript `any` introduced (or justified inline)

## Release Notes
<!-- Required when src/ or package.json is touched. One bullet per user-visible change. -->
- <!-- e.g. feat(s3): add `expiresIn` to presigned upload helper -->

## Breaking Changes
<!-- If you checked "Breaking change" above, describe the migration path. -->
- <!-- What changed, who is affected, and how to migrate. -->

## Screenshots / Logs
<!-- Only if relevant. Skip otherwise. -->

## Approvals Required
<!-- Do NOT merge until: -->
- [ ] At least **1 approval** from a code owner listed in `.github/CODEOWNERS`
- [ ] All **Required Checks** above are green
- [ ] Conversation is resolved