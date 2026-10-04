# Observed injuries and health losses

BroBot now records its own public Mineflayer hurt observations and measured health decreases in the journal and dashboard feed. Snapshots retain the most recent eight plain copied records. Sources are included only when the public event resolves an entity; unavailable sources remain unavailable. No nearest-monster guess, environmental-cause guess or player username is retained.

Hurt and health packets have independent timing. A hurt-time health value is labeled as observed, not final health or damage amount. Repeated animations are observations, not a count of damaging hits. Health loss remains unattributed even if a hurt observation happened nearby in time. Existing safety handling runs before diagnostic writes.

365 automated checks passed. Tests cover own/other entities, source ID zero, unknown sources, copy isolation, healing and food-only packets, both event orderings, initial spawn, respawn, lethal loss, bounded history and retired connections. A regression using the installed Mineflayer health plugin verifies the first loss after respawn (20 → 17), including its health-before-spawn ordering.

The isolated real-server health fixture passed on frozen source 15cdc9a. It applied controlled damage during actual log digging, observed an unavailable hurt source and a separate 20 → 7 health loss, and paused work. All observer/runtime/harness source hashes are retained. This is diagnostic and cancellation evidence, not proof of injury prevention or natural-world success.

A new full known-world evaluation is running separately on this corrected frozen source. Its results are pending and must not be substituted into the published Core 0.2 scores. A previous evaluation attempt was stopped during prepared preflight before any natural-world case when review found the respawn baseline issue; that source was corrected before this evaluation began.
