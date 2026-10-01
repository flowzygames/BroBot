# Alpha 1.0 readiness

Alpha 1.0 is a development milestone for a local Minecraft companion, not a
claim that BroBot can autonomously beat Minecraft or perform arbitrary tasks.
A release label must follow the evidence rather than a deadline.

## Supported scope

- Local Java server and optional Bedrock bridge setup
- Owner-gated direct commands and an interruptible local dashboard
- Bounded offline starter: stone pickaxe, furnace, verified return to start
- Explicit pause and resume, useful failure reports, no silent restart
- Optional paid API planner, clearly separated from offline capabilities

## Release gates

- [x] Final committed source passes all syntax and automated checks
- [ ] Windows and Linux CI pass for the published source
- [x] All prepared live regression scenarios pass on the final source
- [x] Frozen three-seed Trailhead suite rerun, with every result retained
- [x] Additional fresh-world seeds assessed and failures explained
- [x] Start, stop, blocked, resume and disconnected dashboard states checked
- [ ] Clean ZIP contains required source, a dependency lockfile and setup docs
- [ ] Public download matches its published checksum
- [ ] Website, README and release notes agree on capabilities and limitations

Do not turn infrastructure failures into gameplay scores. Preserve unsuccessful
runs. Development seeds are not held-out evidence. If autonomy does not meet its
stated scope, publish an honestly labeled development build with the fixes and
remaining blockers rather than relabeling it as complete.

## Known verification limits

Rendered Windows/macOS Minecraft gameplay and paid-model planner runs have not
been verified in this cloud execution environment. Automated cross-platform
checks do not substitute for those tests. Keep these limits visible in release
notes. No API spending is authorized by this checklist.

## October 1 checkpoint

Tested application c1e0196: 194 automated checks, 17 prepared live phases, original development worlds 3/3 and additional development worlds 2/3. The canopy case still fails. UI state coverage includes automated dashboard tests; actual rendered Windows/macOS Minecraft gameplay remains unverified. A checked evidence gate is not a stable-release declaration. Publication, CI and download integrity are verified separately for their exact commits.
