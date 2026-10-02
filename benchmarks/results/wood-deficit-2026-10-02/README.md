# Wood prerequisite and powder safety checkpoint

Frozen source9633598 has293 passing automated checks. The starter now requests only the remaining wooden prerequisites instead of always collecting another3 logs before its first pickaxe. The powder-snow warning from PR11 is included. This remains a development preview.

Selected known-world trials use the unchanged300-second natural survival protocol. World1041160109 passed in184.464seconds at20health with both items and home distance1. World1276821265 failed after128.868seconds with exploration exhausted. That is1/2 selected trials, not a broad reliability score. A pre-gameplay server-download error on104 is retained separately; the unchanged-source restart followed repair of the local official Minecraft cache.

The passing104 replay changed scout direction before wood gathering and used one complete3-log batch. It did not exercise the changed partial-prerequisite branch. Therefore it does not prove this fix caused the earlier timeout to disappear. The resource-deficit behavior is covered by deterministic controller tests.

The previous287 build completed9/20 with one disclosed infrastructure recovery, while the earlier275 build completed12/20. Those frozen results remain historical and must not be relabeled as current-source results. Return-route verification, pickup recovery and repeated scouting remain work in progress.

Prepared validation on the same frozen source passed 17/17 live regression phases, 11/11 skill cases and 20/20 local controls. No paid model calls or rendered Windows/Mac/Bedrock client gameplay were tested.
