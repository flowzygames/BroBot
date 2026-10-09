# Yield confirmed collection progress at a shorter action deadline

A selected local natural trial stopped its entire 300-second starter job after 87.830 seconds. Its last collection had already confirmed two mined blocks, gained one birch log and retained an observed drop. The next dig was correctly refused before any packet because that action's remaining allowance could not cover digging plus server confirmation. The controller treated the same mining-admission code as a reason to pause the whole job, even though approximately 212 seconds of job time remained.

The collector now returns an incomplete, `mining_admission_limited: true` result only when all of these hold:

- At least one block in that action has already completed confirmed mining.
- The error is the pre-dig `MINING_DEADLINE_INSUFFICIENT` refusal.
- Explicit finite action and job deadlines exist.
- The effective operation deadline is exactly the action deadline, strictly earlier than the job deadline.
- The job deadline is still live and existing cancellation/session/terrain checks passed.

The action ends immediately without another mining attempt or its final pickup sweep. It retains inventory changes, confirmed mined count, observed remaining drops and existing pickup safety flags. The runner still drains and cleans up before releasing its action lock.

No controller retry loop or larger allowance is added. Existing controller logic observes again under the original job deadline and normal step limits. Fresh usable inventory can prioritize crafting; if gathering remains necessary, scoped observed-drop recovery can precede more mining. Confirmed block removal alone is not fabricated inventory progress.

Job-bound, tied, local or unknown deadline scopes remain errors. Zero-progress admission refusal, cancellation, unconfirmed mining, terrain quarantine and unsafe pickup remain fail-closed. Generic `dig_at`, canopy descent and private excavation are unchanged.

The deterministic positive fixture failed before the correction and passes afterward. Controls retain the original pause behavior, and controller fixtures verify fresh-state craft/pickup choices, the unchanged job deadline and normal action counts. Natural survival results must be reported separately; this correction does not itself establish completion or readiness.
