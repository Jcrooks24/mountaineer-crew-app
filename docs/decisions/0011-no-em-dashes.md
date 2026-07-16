# 0011. No em dashes

**Status:** Active. Hard invariant.

## Context

House style. The owner does not want em dashes in this product, in code comments,
in UI copy, in commit messages, or in anything the app generates.

The same rule applies to the sibling project, `mountaineer-cleaning-crm`.

## Decision

Do not use em dashes (the long `—` character). Use a plain hyphen, a comma, a colon,
parentheses, or a full stop.

This applies to:

- UI copy and help text
- code comments
- commit messages
- documentation, including this file
- anything the app renders or exports

## Why it is written down

It is not a code-quality rule, so there is no linter for it and nothing fails if you
break it. It is easy to violate by accident, especially with AI-assisted editing,
which reaches for em dashes constantly. Writing it down is the only enforcement.

If you are reading this as a new maintainer and you do not care about this rule: it
costs nothing to follow, and the owner will notice.
