# Powder snow safety followup

The expanded cohort identified a low-health failure in world1888406977. Inspection showed powder snow occupying the spawn feet cell before any movement.

A route-avoidance-only experiment ac5823f did not solve existing exposure: the bot remained at its starting position and stopped after39.2seconds at5.67health. Its failed result is retained.

The added contact preflight on8d43026 paused the starter after0.160seconds with20health and empty inventory, before gathering. This remains a failed starter-objective benchmark. It is a faster hazard warning, not autonomous escape or a new completed world. The warning explicitly says freezing continues after work stops and asks the player to move BroBot onto dry solid ground.

The final b8be5bc differs only in a test expectation. All290 automated checks passed. Bounded starter paths also avoid powder snow; ordinary direct commands retain their previous movement policy. Contact detection covers observed feet, head and body-edge cells. This is not a guarantee against external displacement or environmental changes during an in-flight action.

The published287 download and its9/20 evaluation remain separate. This candidate has no full-cohort score.

Final candidate0a8fff4 covers thin body-edge overlap using a numerical epsilon. All291 automated checks passed. The final targeted replay paused after0.145seconds at20health, before gathering. This is still an incomplete survival objective. The prior b8be5bc prepared smoke passed17/17; that fixture result predates the thin-edge predicate adjustment.
