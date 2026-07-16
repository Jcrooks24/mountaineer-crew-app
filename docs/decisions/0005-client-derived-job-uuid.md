# 0005. `job_uuid` is derived on the client by hashing, not assigned by the server

**Status:** Active. Fragile. Read before touching.

## Context

Jobs must be identified by a unique key, never by name alone. Two jobs can be called
"Smith" and the office must be able to tell them apart in the Sheet.

But the crew is frequently **offline** when they start a job. If the server assigned
the id, then a Bill of Lading captured with no signal, a clock-in captured with no
signal, and a materials log captured with no signal would each have no way to know
they belong to the same job. They would sync later as three orphans, and the office
would see the job split into pieces.

## Decision

**The client derives `job_uuid` deterministically by hashing the job's identity**
(an FNV-1a hash rendered as a UUIDv4-shaped string). Same job, same inputs, same
uuid, on any device, with or without a network.

So a BOL and a clock-in captured on the same phone with no signal land on the same
`job_uuid` without either one having talked to the server. When the queue drains,
they reassemble correctly.

Related: `bolStore.resolveJobUuid()` prefers the **server's** `job_uuid` when
online and falls back to the local hash when offline. The two are assumed to agree.

## Consequences

- The hash function is implemented **twice**, in `App.tsx` (`stringToJobUuid`) and in
  `bolStore.ts` (`calEventToJobUuid`), and the two implementations **must stay
  byte-identical**. If they drift, a BOL lands on a different `job_uuid` than the
  clock-in events for the same job, and the office sees one job as two. Nothing in
  the code enforces this. It is a comment and a prayer.
- Normalization matters: `manualJobToJobUuid` strips whitespace and lowercases before
  hashing, so "Smith " and "smith" do not become different jobs.
- A set of localStorage keys (`crew_active_job_uuid_v1`, `crew_job_meta_v1:`,
  `crew_job_name_v1:`, `crew_job_date_v1:`) is a **cross-feature contract**. The
  Timeline writes them; BOL, PODS, and DVIR read them to autofill the job and land on
  the same uuid. Renaming those keys breaks job correlation in the Sheet.

## What would break if you undid this

Server-assigned ids would break offline job correlation completely, which is the
core use case. If you want to unify the two hash implementations (a good idea),
extract them into one shared module and change nothing about the algorithm. Any
change to the hash function orphans every job already in the database and the Sheet.
