# Frozen downloadable candidate workflow

A candidate is a test artifact, not a public release or a paid-beta readiness claim. Keep the existing showcase ZIP and release metadata unchanged until a candidate passes its acceptance gates and publication is authorized.

## Build and verify

Run from a Git checkout with Node 22.9+ and Git installed:

    npm run release:build -- FULL_40_CHARACTER_COMMIT_SHA
    npm run release:verify -- dist/brobot-candidate-SHORT_SHA.zip dist/brobot-candidate-SHORT_SHA.zip.json "fresh candidate directory"

The builder reads committed Git blobs, not dirty or untracked files. It uses a fixed allowlist, includes launchers, lockfile, source, tests, docs and license notices, and rejects selected symlinks/submodules. Dependencies, worlds, local settings, logs, showcase files and historical benchmark archives are excluded. Historical README evidence links refer to the source repository; they do not establish this artifact's test result. Filename exclusions are not a general secret scanner; review committed content before distribution.

Stored ZIP entries have fixed timestamps and modes, sorted paths and CRCs. A fixed source commit produces identical bytes without depending on compression-library versions. The embedded manifest records source commit/tree, every packaged file's checksum and size, and explicitly starts with evidence status `not_run`. An external sidecar holds the final ZIP and manifest checksums. Checksums establish consistency with a trusted sidecar, not publisher authentication or independent proof of a Git commit.

The verifier accepts only this narrow archive format, validates local/central records, safe Windows-compatible paths, collisions, modes and checksums, and extracts only into a fresh directory. Verify extracted bytes before installing dependencies. After `npm ci`, node_modules is an expected new installation and the pristine file-set check no longer applies.

## Extracted installation gate

    npm run check:release -- FULL_40_CHARACTER_COMMIT_SHA "fresh acceptance directory"

This creates the immutable ZIP and sidecar, extracts into a path containing spaces, verifies every file, then runs a real `npm ci` and `npm run check` inside that extracted application. It uses neither shared node_modules nor a source-checkout installation. After the checks, it executes the shipped platform launcher with piped input and no EULA acceptance. This must exit with code 1, show the explicit Minecraft EULA refusal, create only the default .env and dependency marker, and leave .server and bot data absent. It exercises noninteractive refusal, not a person typing “no”. The launcher is allowed to perform its real first-launch dependency installation; the gate does not pre-seed its marker.

The external verification.json binds the platform, commands and results to the ZIP checksum. The launcher refusal is a separate passed check with expectedExitCode 1; that expected nonzero exit is not an installation failure. Timeout, excessive output or interruption triggers termination of the created process group/tree. Unconfirmed cleanup and helper exceptions remain explicit failed checks; they are never reported as a safe refusal. The ZIP itself is never rewritten with a claimed passing score. CI runs this gate on Windows and Linux in addition to normal source checks, retaining the candidate, sidecar and verification result for 14 days with [GitHub artifact uploads](https://github.com/actions/upload-artifact).

This gate runs the actual wrapper on each OS, but does not launch a Minecraft graphical client, accept the EULA, create a world, charge a customer, or verify Bedrock gameplay. Those remain separate acceptance steps.

## Before public release

- State the exact supported audience and a small set of reliable user-visible actions
- Test the actual extracted launcher, first-run configuration, EULA refusal/acceptance, readiness and shutdown on each advertised OS
- Join using a real supported Minecraft client; test owner authorization, commands, cancellation and restart persistence
- Run prepared integration against the frozen application and retain failures as well as successes
- Keep supplied-material/terrain tests separate from complete natural-world starter evaluations
- Verify the downloaded public bytes match the approved ZIP, sidecar and feature claims
- Treat payment account setup, pricing, customer access and cancellation as separate decisions and tests
