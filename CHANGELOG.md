# Changelog

## 1.0.2

- Rebuilt the EasyMagicItems configuration window with the shared EasyModules visual identity used by EasyLoot, EasyWounds, and EasyTraps.
- Added focused **Draw Defaults**, **Delivery**, and **Cinematic** sections with card-based controls, custom switches, scope badges, responsive layout, and clearer hierarchy.
- Added a non-destructive **Restore defaults** control inside the configuration window; changes are still only persisted when **Save Settings** is pressed.
- Added clear visual feedback when the opening-theme option is overridden by the master audio setting.
- Preserved direct access to every setting through Foundry's normal Module Settings page.
- Standardized the package license to **EasyModules Software License — Version 1.0**.
- Lowered the minimum Foundry VTT version to 13 while retaining verification against 14.364.
- Made EasyModules Hub 1.0.6 or newer a required dependency.
- Updated release metadata, README requirements, compatibility documentation, and the version-specific GitHub download path.
- Preserved the existing public API, draw logic, recommendation behavior, sockets, item delivery, and cinematic sequence.

## 1.0.1

- Refined the card entrance to match the approved EasyTrials-style pacing with a softer fade, gentler movement, and synchronized per-card audio.
- Added a visible white-blue border glow and light sweep without clipping inside the card frame.
- Added synchronized card-by-card opening using shared absolute timestamps for connected clients.
- Cards remain hidden until their individual entrance begins, then arrive, flip, and receive a luminous sweep with matching audio.
- Shortened the opening theme and refined its fade-out.
- Added a separate client setting for the opening theme while preserving the master audio switch.
- Locked draw interactions until the cinematic entrance has completed.
- Removed abandoned animation paths, duplicate cleanup logic, unused template data, obsolete configuration styles, and unused code variables.
- Removed obsolete legacy audio filenames from the maintained source package.
- Made the public API report the installed manifest version to prevent future version mismatches.
- Restored and verified all bundled audio files and the included third-party license document.
- Reviewed the manifest, dependencies, documentation, local asset references, GitHub release paths, archive structure, and file permissions.

## 1.0.0

First public release.
