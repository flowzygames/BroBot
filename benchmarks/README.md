# BroBench: reproducible development scores

These tests measure distinct capabilities, not a single intelligence rating.
The protocol is in `protocol.json`. Keep its version fixed across a comparison;
change the protocol version whenever conditions, scoring or cases change.

- **MineLine**: actual mining and inventory pickup in three prepared scenarios
- **Workbench**: six supplied-ingredient crafting scenarios
- **Pathfinder**: two prepared movement scenarios
- **CommandSense**: fourteen explicit local command forms, not LLM comprehension
- **SafetyLatch**: six deterministic fault/control checks, including a simulated API outage
- **Trailhead**: one offline command in each of three fresh natural survival worlds,
  starting empty at fixed spawn radius zero, returning with a stone pickaxe and furnace within five minutes
- **GoalSense-LLM**: reserved for a separately configured paid-model evaluation;
  report **not run** while the key/budget is unavailable

## Running a version comparison

Use Node 22 or 24 and the normal server setup/EULA flow. Every run writes a JSON
record under ignored `.server/benchmarks/`, with commit, environment, conditions,
case outcomes, errors and timestamps. Worlds/logs remain there for inspection.
The user's normal world is never reused by these harnesses.

Run `npm run benchmark:controls -- --label=candidate` and
`npm run benchmark:skills -- --label=candidate`, then run
`npm run benchmark:survival -- --seed=718224 --seconds=300 --label=candidate`,
repeating with seeds 42 and 20260930. Run live evaluations sequentially so
resource contention does not bias pathfinding time budgets.

Pass `--repo=/absolute/path/to/other-checkout` to the same harnesses to evaluate
an older version with the same installed locked dependencies. Record whether a
feature was unavailable; do not silently drop unsupported tests or failed runs.
The earlier PR 4 version has no offline starter job; Trailhead records this as
unsupported. That is a feature-availability comparison, not evidence about how
its separate paid planner would perform.

Score each group as successes/scheduled cases and show the denominator. Do not
reuse development runs as final results without labeling them. Do not average
in a score for the unrun LLM suite. Three worlds are too few for a claim of
broad reliability. These seeds are development cases, not held-out evidence.

Before a major release, rerun the frozen protocol for both the intended baseline
and candidate, retain every result, investigate regressions, and publish the
measured comparison with these conditions. A blue cell means the best measured
score on that row, not a guarantee that the candidate wins every row.

Trailhead fixes spawn radius to zero before the bot connects, to make starting
positions comparable. It does not change terrain, supply items or intervene
during the job. This differs from early development probes with vanilla random
spawn positions; those probes are retained but not mixed into the final score.
