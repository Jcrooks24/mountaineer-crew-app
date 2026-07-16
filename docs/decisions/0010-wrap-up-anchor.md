# 0010. The wrap-up estimate stores a time anchor, not a timestamp

**Status:** Active. Newest entry; included because it is exactly the kind of thing
someone would "simplify" and break.

## Context

The Job Report has a wrap-up estimator: the crew calculates the drive time from
where they are back to dispatch, adds any billable work still to do once they get
there (trash, unstocking the truck), and gets a projected clock time for when the
job actually finishes. An employee can then pick that projection as their End time
in the hours editor.

The first version had two problems the crew reported from the field:

1. It had two buttons ("calculate return trip" and "generate wrap-up time"), which
   were redundant.
2. The wrap-up timestamp often did not exist at all.

The obvious implementation, and the one we started with, was to compute a timestamp
on button press and store it.

## Decision

**Store the anchor (the moment Calculate was pressed) plus the minute inputs. Derive
the timestamp: `wrapUpAt = anchor + drive + tasks`.** Never store the clock value.

**And stamp the anchor unconditionally, before the drive-time lookup runs.**

## Consequences

Both halves buy something specific:

- **Deriving from an anchor is what collapsed the two buttons into one.** Because the
  projection is computed, editing a minutes field moves it live. There is nothing to
  "regenerate", so the second button had nothing to do. It also keeps the estimate
  pinned to when the crew actually took the reading, instead of silently sliding
  forward with the wall clock.
- **Stamping the anchor before the lookup is what fixed "the timestamp is not being
  created".** The old code only produced an estimate if the drive-time call
  succeeded. Offline, or with GPS denied, or with the Maps key unset, the crew got
  nothing at all. Now they always get an estimate, and the drive-minutes field is
  hand-editable, so the tool works with no signal.

The estimate persists to localStorage per `job_uuid`, because the estimator lives
inside the Job Report, which unmounts on every tab switch. There is no database
column and no migration; the wrap-up reaches the server only if an employee picks it
as their End time, at which point it is just an `HH:MM` like any other.

## What would break if you undid this

- "Simplifying" the anchor into a stored timestamp brings the second button back and
  makes the projection stale the moment anyone edits a minutes field.
- Moving the anchor stamp inside the lookup's success path silently reintroduces the
  original bug: no estimate at all whenever the crew has no signal, which is exactly
  when they are most likely to be using it.
