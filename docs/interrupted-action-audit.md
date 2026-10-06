# Interrupted starter action receipts

A Stop request or hostile-recovery request can arrive while a physical action is still draining. Its final result may describe blocks already changed or inventory already gained even though starter processing must pause.

The starter job keeps up to eight such results in `interruptedActions`, separate from its normal `history`. Each entry records the action, timestamp, and resolved/rejected outcome. Available receipts also include the arguments and a detached copy of the reported result. Rejected results also retain the error message and code. The entry is audit evidence, not a claim that the starter task completed.

- A receipt is attached only while the same job object, job ID, controller, and signal still own the action
- Results are recorded before existing Stop or hostile-recovery checks take precedence
- Missing results do not fabricate zero effects
- Uncopyable results are marked `result_available: false`, with a null result and a capture error
- Persistence failure stops further recovery; it does not silently continue with an unsaved receipt
- Old saved jobs without the optional field still load; malformed present audit entries are rejected

These receipts do not enter the normal progress history or grant route, pickup, retry, or mining authority. Existing cancelled-scout evidence handling is unchanged. Restarting preserves the audit but does not replay an action. This change does not connect the private soil/stone executors to automatic starter mode.
