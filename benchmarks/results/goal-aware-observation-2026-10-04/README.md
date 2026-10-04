# Discover trees only when the starter decision needs wood

The selected resource-search development run of known seed113919219 spent substantially more time between inspect and the next action than the preceding return-priority trial. The broadened log search was running on every observation, even after logs or tools were already acquired. Route divergence also contributed; these trials do not establish a precise isolated timing effect.

The starter observer now uses its fresh inspected inventory and job state to skip tree/foliage discovery when it can already craft, mine, eat or return. It still observes workstations, item-drop clearance and powder-snow contact. Empty inventory or missing wood prerequisites still trigger the full bounded-radius tree search.

Seven new tests cover carried logs, mining-ready inventory, completed kit, urgent eating, empty inventory and missing handles. All 335 automated checks passed. No benchmark scores are changed by this patch.
