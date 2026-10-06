# Frozen main 959-check release-readiness probe

Source: `9b3a070f539a68015eb50ae367a86f0f1a29df7b`, tree `4bed6c62a78079aaf4db837c3714dd3a89b96574`. The source checkout stayed clean during the prepared run. This is not a new public release or natural-world score.

## Prepared Java integration

- First run failed before gameplay because Paper's Java downloader could not resolve piston-data.mojang.com and the pre-existing verified Mojang cache was in the wrong directory layout
- Cached Mojang 1.21.8 bytes matched the Paper embedded SHA-256 `2349d9a8f0d4be2c40e7692890ef46a4b07015e7955b075460d02793be7fbbe7`; no replacement download or new EULA acceptance was used
- Correctly locating those cached bytes allowed the second isolated run to pass **17/17 prepared phases**
- Passed result SHA-256: `27d2dbd660c7ce7416394418b0ddd4a091f3d60b2a1f62f58171b956874828d6`
- Both runs' results and server logs are retained in `prepared-smoke-records.tar.gz`, SHA-256 `d5a17c14ff4b5fe01cd64371e248f5a1f5bf1fd8583100f013bdb11b5a1b9399`
- Minecraft server stopped after the run; no normal play world was used

These tests use prepared terrain and supplied ingredients for later furnace, equipment, food and portal cases. Bridge startup is not rendered Bedrock gameplay. A Linux server run is not Windows launcher/client verification.

## Extracted candidate probe

A separate deterministic candidate was built from the same source, extracted into a path containing spaces, and independently checked with Python zipfile's CRC validation. It contained 184 entries, including the generated manifest.

- ZIP SHA-256: `d55097c56626605046d74122639df33f9e720707c10a5868f76f33252f5e839d`
- ZIP bytes: 1,851,722
- Sidecar: `candidate-sidecar.json`
- Offline npm installation first refused because one dependency was not cached
- Fresh network-backed `npm ci` then installed 94 packages into the extracted directory, without shared node_modules
- Extracted `npm run check`: **958 passed, 1 failed, 959 total**

The failure was the virtual-removal bookkeeping test exhausting its unchanged 2-second planner budget on the large saved-world fixture under load. The assertion received a null plan. This candidate is therefore **not an accepted release**. The packaging branch changes that bookkeeping-only test to the existing small flat fixture, retains the separate saved-world test, and leaves production deadlines and safety checks unchanged. A newly frozen artifact must pass independently; this failed candidate is not retroactively relabeled.

The public Core 0.2 ZIP and Vercel download remain unchanged.
