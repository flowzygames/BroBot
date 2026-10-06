# Navigation helper ownership checks

These are modeled regression checks, not new Minecraft survival scores.

The previous walking and dropped-item pursuit helpers could clear a replacement
pathfinder when it reused the same goal object or did not expose a goal field.
A synchronous goal-clear listener could also start newer movement before the
old helper cleared shared controls. Success predicates could transfer ownership
and still report a completed arrival or verified pickup landing.

Both helpers now capture their pathfinder, check ownership before starting or
reporting success, and recheck after eventful cleanup. Replacement detection
rejects promptly on observed events or the existing bounded poll. An optional
strict-true ownership callback supports private callers whose facade ownership
can change while the pathfinder and goal remain the same. It describes control
ownership, not health, cancellation or job completion. Ordinary cancellation
still stops controls that the helper owns.

Nineteen additional cases cover replacement on abort, arrival, pickup, path
failure, polling, missing goal fields, late events, reentrant cleanup, initial
and landing predicates, and optional owner guards. The navigation suite has
51 cases. The pre-fix tests reproduced unwanted cleanup and false success.

Scope: this changes navigation helpers only. It does not grant a blanket
ownership guarantee to every Actions handler or third-party event listener.
Prepared-world and natural-world results remain attached to their separately
frozen builds. No release download or benchmark score changes here.
