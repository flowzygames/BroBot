# Validation immediately before mining

Mineflayer 4.39.0 normally awaits lookAt inside dig(block, true) before sending a start-dig packet. A block update or cancellation during that await could make the prior checks stale.

BroBot now explicitly awaits the same center aim, checks cancellation and fresh target identity, footing, reach, tool and environmental hazards, then calls the library's supported ignore-look mode. An installed-library reviewer harness confirmed the same aim, forced-look setting and face=1, with synchronous start-packet emission after the final checks. This does not guarantee protection from hazards arising during the subsequent timed dig.

358 automated checks passed. New cases cover fluid arrival, cancellation, target replacement, changed footing and changed tool during aiming. The first two fail before the fix and pass after it. Existing canopy stage/support cancellation tests remain covered; their mocks now provide the real API's lookAt method.

The full prepared integration passed 17/17 phases on frozen source 3dd5bf9708906039f97db7356b8450fd0f4ede67. Application and harness hashes match this publication. The release branch additionally retains the stronger real-Mineflayer candidate-cap regression from the preceding PR. Prepared tests use supplied fixtures and materials and do not establish natural-world survival reliability.

Core0.2's published ZIP and frozen 11/20 cohort and 1/3 regression remain unchanged. These are source follow-ups, not substituted scores.
