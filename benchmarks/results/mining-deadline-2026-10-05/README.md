# Mining admission before deadlines — October 5, 2026 UTC

## Observed bug

In selected world 1744809425, a new collect began at 23:29:50.049 UTC and the
existing job deadline interrupted its mining only 682 ms later. The unconfirmed
edit correctly quarantined/disconnected the bot, but admitting that fresh edit
with almost no time left was avoidable. This did not explain the world's earlier
lost logs or unreachable resources.

## Fix

The starter invocation now carries one monotonic deadline through Runtime into
its action context. ActionRunner supplies its own unchanged timeout deadline;
mining uses the earliest deadline. The local 20-second notch action narrows it
again. Explicit resume starts a new deadline; monotonic timestamps are not saved.

After equipment and aiming settle, confirmedMining requires its existing full
allowance—ceil(predicted dig time)+5000 ms receipt allowance+1000 ms scheduling
allowance—to fit. It checks before installing observation and again immediately
before the first dig call. No await occurs between final admission and digging.
The receipt allowance is never shortened to squeeze into the time remaining.

A typed refusal before attempting an edit sends no mining packet and does not
quarantine. Collection preserves earlier confirmed counts/inventory/drops, and
the starter pauses without adding resource exclusions or retry/scout churn.
Existing hard timers and quarantine for genuinely interrupted attempted edits
are unchanged. Estimation cannot guarantee that an admitted operation finishes.

Scope covers ordinary runtime mining, starter jobs and the local notch timer.
Current progression helpers do not mine; if they gain nested collect/dig actions,
their wrapper must also carry the parent deadline.

## Verification

Final integrated source: `ff36671bf1cd5cec4a37164b2ecc79c91130b0a9`.
606 automated checks passed, including insufficient/malformed/exact deadlines,
time lost during observation setup, final tool estimate, partial collection,
controller pause/resume, and the local notch cap.

The real prepared server fixture verified:
- An 8-second starter job refuses before its first mining attempt, stays
  connected/trusted, and leaves the prepared oak log intact
- A 1-second action cap takes precedence over a 30-second job budget and likewise
  refuses before mining
- A sufficiently budgeted action then mines that same log, receives the server
  air update and obtains one oak log in inventory

Normal prepared Minecraft integration passed 17/17 on the same frozen source.
The normal result format lacks commit metadata; the clean frozen checkout and
manifest establish provenance. No cleanup error occurred.

The raw fixture records outgoing mining-status packets; it does not separately
archive incoming receipt packets. Successful production mining still requires
its server-air receipt and matching loaded state. The manifest includes nested
experimental source files as well as the top-level modules.

## Retained attempts and limits

The first standalone fixture incorrectly counted every block_dig packet as a
mining operation. Its observed status 5 packets were release-use-item cleanup,
not start/cancel/finish-dig. It failed and is retained. The corrected fixture
checks mining statuses 0/1/2 while retaining all packets; a standalone pass and
the final integrated pass are separately archived.

This prevents avoidable near-deadline mining admission. It does not extend
budgets, fix resource reachability, prove natural-world completion, change the
old full-cohort score, publish a stable 1.0 release, or update the public ZIP/site.
