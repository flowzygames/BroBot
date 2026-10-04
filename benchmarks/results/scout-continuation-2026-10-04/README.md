# Continue searching after a stationary failed scout

In the frozen 342 development run of known world 924242050, the final stationary period repeated 22 stone-collection batches while unsuccessful scouting had not changed the position or inventory. Collection consumed about 212 seconds of the full run. This is a diagnosed workload, not a new score.

After an explore action reports only unverified route attempts without movement or inventory change, the controller may try the next bounded scout directly. It still inspects the world first. Fresh inventory, location, resource/terrain observations, or block/chunk revision changes discard this continuation. Crafting, eating, completion and returning retain priority. The hint is local to the current controller invocation and cannot survive restart/resume.

Runtime observation includes local terrain and tracks block updates plus chunk load/unload events, because the generic resource list omits stone and is not exhaustive. Scout, step, time and movement-certification limits are unchanged.

346 automated checks passed. The unchanged-collection regression fails against the previous b725 source and passes with this change. Added checks cover fresh resource evidence, actual movement, new crafting materials and real runtime terrain-event invalidation. Fresh live validation is pending; public benchmark scores and download are not changed by this note.
