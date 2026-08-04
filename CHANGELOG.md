# Changelog

## 1.0.1

- Refined the card entrance to match the approved EasyTrials-style pacing with a softer fade, gentler movement, and synchronized per-card audio.
- Added a visible white-blue border glow and light sweep without clipping inside the card frame.
- Added synchronized card-by-card opening using shared absolute timestamps for connected clients.
- Cards remain hidden until their individual entrance begins, then arrive, flip, and receive a luminous sweep with matching audio.
- Shortened the opening theme and refined its fade-out.
- Added a separate client setting for the opening theme while preserving the master audio switch.
- Locked draw interactions until the cinematic entrance has completed.
- Removed abandoned animation paths, duplicate cleanup logic, unused template data, obsolete configuration styles, and unused code variables.
- Made the public API report the installed manifest version to prevent future version mismatches.
- Restored and verified all bundled audio files and the included third-party license document.
- Reviewed the manifest, dependencies, documentation, local asset references, GitHub release paths, archive structure, and file permissions.

## 1.0.0

First public release.
