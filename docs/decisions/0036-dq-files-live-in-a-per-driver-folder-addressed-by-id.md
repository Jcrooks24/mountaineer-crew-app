# 0036. DQ files live in a per-driver folder, addressed by ID

**Status:** Active. Shipped to staging 2026-08-10.

## Context

Driver Qualification documents are DOT compliance records: medical cards, MVRs,
employment applications, road tests. In an audit the office needs to produce one
driver's complete file. They also contain PII.

They previously landed in `Mountaineer Crew Documents / DQ - <driver name>`, via
`upload_file_to_drive(category=...)`. Two problems with that:

1. **The parent was resolved by folder NAME** (`DRIVE_DOCUMENTS_FOLDER_NAME`).
   Two environments with the same folder name resolve the *same physical folder*,
   so staging test uploads land among real drivers' compliance documents.
   `CREDENTIALS.md` already warned about this specific case.
2. **The subfolder was resolved by name on every upload.** A driver who changes
   their name (marriage, correction of a typo in the roster) gets a *new* folder
   on their next submission, silently splitting their compliance file in two.
   Nobody notices until an audit asks for the whole file.

## Decision

**A dedicated top-level folder, per-driver subfolders, addressed by ID.**

- `DRIVE_DQ_FOLDER_ID` names the parent. Set per environment.
- The driver's subfolder is named for the driver and created on their first
  submission.
- Its ID is persisted (`dq_documents.drive_folder_id`, migration
  `c3e5g7b9d1f3`) and used directly on every later upload.

Two sub-decisions worth stating, because both are tempting to undo:

**There is deliberately no `DRIVE_DQ_FOLDER_NAME` fallback.** BOL has one, kept
for backward compatibility, and it is the hazard ADR 0020 documents. DQ is new
enough to skip it. When `DRIVE_DQ_FOLDER_ID` is unset we fall back to the
*previous* behavior (the Documents folder) rather than resolve a new folder by
name: an unset variable should reproduce the old layout, not scatter PII into a
new place nobody is watching. Adding a name fallback "for convenience"
reintroduces the shared-folder failure for the documents where it matters most.

**`drive_folder_id` is denormalized onto every one of the driver's rows.** It is
per-driver data on a per-document table. This looks redundant and is: a separate
`dq_driver_folders` table would normalize it. It was not worth a join and a
second model for one string on a table already keyed `(user_id, doc_type)`. Any
of the driver's rows can answer "which folder is theirs."

## Consequences

- A stored folder that was trashed by hand in Drive is detected and recreated
  rather than failing every subsequent upload.
- An existing `<driver name>` folder under the parent is adopted, not duplicated,
  so pre-creating folders by hand works.
- Existing rows have `drive_folder_id` NULL and resolve by name once on their
  next upload, which reproduces today's behavior exactly. No backfill needed.
- **Old DQ files are not moved.** Documents uploaded before this change stay in
  `Mountaineer Crew Documents / DQ - <name>`. A driver's file is split across the
  old and new locations until each document is re-submitted. Moving them is a
  one-time Drive operation against production PII and is the user's call, not
  something to do silently in a deploy.

## Not addressed here

DQ files are granted `anyone with the link` reader access, which is wrong for
PII. That predates this change and is unchanged by it, because the frontend links
straight to `webViewLink` and removing the permission would break viewing for
every driver. Fixing it means proxying downloads through an authenticated route.
Logged in [RUNBOOKS.md](../RUNBOOKS.md) Known defects.
