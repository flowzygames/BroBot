# Query-scoped skip evidence for completed empty collection

Historical failed resource positions remain in collection's skip history as the bot moves. A skip outside the current resource sphere cannot exclude a target from that query, but previously the total history count prevented a completed empty cursor scan from issuing a transient retry hint.

This change preserves total `skipped_positions` telemetry and adds `query_skipped_positions`, counted from the complete validated, deduplicated history against the same floored origin and inclusive Euclidean radius used by target filtering. The count is recomputed on every scan, including resumed pages. It is not inferred from which callbacks happen to run on the final page.

Only explicit zero query skips can support a complete-empty hint. Missing, malformed or nonzero scoped evidence is rejected. Total history must remain a nonnegative integer. Native or cached-candidate observations remain ineligible. The full history still participates in continuation identity: changing even a distant skipped coordinate starts a fresh cursor.

The transient hint remains scheduling evidence only. Candidate exclusion, fresh route certification, mining checks, collection and exploration budgets, and the radius-plus-one terrain dependency halo are unchanged. In particular, a skipped coordinate just outside the target sphere may still be a relevant exposure neighbor; a terrain update there invalidates the hint.

## Verification boundaries

Real ActionRunner/Runtime fixtures cover outside, exact-boundary, mixed and duplicate skips; fractional negative poses; stationary refused scouts; and radius-plus-one invalidation. Dense three-page fixtures cover inside/outside historical skips and query changes between pages. Receipt tests reject absent and malformed fields. Existing lifecycle and terrain invalidation tests remain applicable.

This removes unnecessary pessimism in scheduling evidence. It does not prove that every historical rescan could have been skipped, that stone is reachable, or that natural-world completion improves. No new full-cohort score is implied. The separately running frozen short-scout cohort does not contain this change.
