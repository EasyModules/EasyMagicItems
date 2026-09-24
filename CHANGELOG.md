# Changelog


## 1.1.0

- Made EasyModules Hub an optional recommended integration. EasyMagicItems runs from its generated macro and native settings without the Hub; Hub dashboard registration remains available when enabled.
- Foundry 14 ActiveEffect compatibility: prefer `effect.system.changes` and use root-level `effect.changes` only as a legacy fallback.
- Removed catalog access to deprecated numeric `ActiveEffectChange.mode`; normalized catalog changes now retain only `key`, `value`, and string `type`.
- No changes to enchantment profile discovery, materialization, resolution odds, or item recommendation logic from test5.

## Development history for 1.1.0

### Test build 5
- Hydrates only compendium entries that expose an Enchant activity before normalizing the catalog, because Foundry v14 indexes do not reliably include nested ActiveEffect change data for enchantment profiles.
- Restores complete profile metadata for official 2024 templates, including profile-specific rarity, riders, semantic variant data, and materialization detection.
- Fixes Armor of Resistance and Ring of Resistance being downgraded to generic `template` resolution instead of `profile-table`.
- Restores the expected official setup-template/profile matrix, including Weapon +1/+2/+3 (3/3 materializing), Armor of Resistance (10/10), Dragon Scale Mail (10/10), Ammunition of Slaying (14/14), Hammer of Thunderbolts (2 total / 1 materializing), and Flame Tongue (1/1).
- Keeps the test4 leaf-field catalog fix and test3 defensive spell discovery/fail-closed behavior intact.

### Test build 4
- Fixed a test3 catalog regression where requesting parent objects such as `system.type` and `system.description` from Foundry v14 compendium indexes could return incomplete rows, causing the entire magic-item catalog to be discarded as non-magical.
- Restored explicit leaf-field indexing for the two trusted first-party catalog packs (`dnd5e.items` and `dnd5e.equipment24`) while keeping spell discovery minimal and defensive.
- Removed unnecessary `system.source` indexing from the legacy spell fallback, preserving the protection against malformed source objects without sacrificing catalog compatibility.
- Preserved all item-resolution, fail-closed Robe, profile, rider, and D&D 6 compatibility changes from test3.

### Test build 3
- Hardened D&D 6 compendium indexing by requesting parent `system.type`, `system.uses`, `system.source`, and `system.description` objects instead of fragile nested index paths.
- Legacy spell fallback now requests a minimal spell-only index rather than reusing the full magic-item catalog field list.
- Malformed primitive collection values are ignored instead of becoming fake effects/activities/riders.
- Hardened initial-use and generated scroll description writes against unexpected persisted shapes.
- Robe of Useful Items now fails closed if a patch label or its Spell Scroll cannot be concretely resolved; it can no longer silently preserve an unresolved generic scroll patch.
- No intended changes to draw odds, resolution tables, enchantment profiles, or recommendation logic from test2.

### Test build 2

- Added a hard item-resolution gate: any magic item with a mandatory acquisition-time variant must be reserved, materialized, and validated before actor delivery.
- Removed the grant-time enchantment-profile fallback; a missing/invalid reserved profile now blocks delivery and rolls back instead of silently choosing a new variant.
- Added official RollTable-driven profile selection for weighted/random variants, including Ammunition of Slaying, Armor of Resistance, and Ring of Resistance.
- Added semantic table/profile reconciliation so malformed official table UUIDs cannot silently apply the wrong resistance; the known Ring of Resistance duplicate/mismatched rows are reconstructed as a one-to-one 10-variant set.
- Added canonical damage-type sanitation, including defensive normalization of malformed `bludegoning` data before resolved effects are delivered.
- Added fully resolved ready-item handling for Potion of Resistance, Carpet of Flying, Manual of Golems, Ring of Elemental Command, Necklace of Prayer Beads, and Robe of Useful Items.
- Added legacy SRD resolution for all twelve pre-formed Armor of Resistance documents, Armor of Vulnerability, Dragon Scale Mail, Manual of Golems, Candle of Invocation, Necklace of Prayer Beads, and Robe of Useful Items.
- Preserved shared-use semantics for the 2014 Necklace of Prayer Beads Curing bead while correctly scaling all rolled bead counts and dawn recovery.
- Added starting-quantity initialization for Bag of Beans, Deck of Illusions, Sovereign Glue, 2024 Universal Solvent, and the legacy Deck of Many Things.
- Ring of Spell Storing is intentionally excluded from the draw pool until stored-spell contents can be materialized safely; it is never delivered as an unresolved ring.
- Added resolution metadata to finalized items and reduced session payload size by storing compact table outcomes rather than repeated full RollTable snapshots.
- Expanded the read-only D&D 5e 6 probe to audit resolution families, legacy Armor of Resistance coverage, weighted Slaying ranges, official Ring table corruption, and unsupported guarded items.
- Kept D&D 5e `verified` at 5.3.3 pending live 6.0.3 regression tests.

### Test build 1

- Added a compatibility layer for D&D 5e 5.3.x and 6.x item rarity data (`system.rarity` and `system.rarities`).
- Rebuilt magic-item template discovery around official hidden Enchant activities instead of treating every enchantment effect as a construction template.
- Added profile-aware variants for official 2024 items such as +1/+2/+3 weapons, armor, shields, ammunition, and Wands of the War Mage.
- Replaced weapon-only construction with a generic magic-item materializer for weapons, armor, shields, ammunition, rings, wands, and other supported official templates.
- D&D 5e 6.x now uses the system `EnchantActivity.canEnchant` / `applyEnchantment` flow plus the official rider materialization API instead of copying all enchantment Active Effects manually.
- Preserved the legacy D&D 5e rider API as a capability-based fallback for 5.3.x.
- Fixed fixed-form magic weapons such as Dagger of Venom being removed from the draw pool simply because they were already fully materialized items.
- Added profile reservation before the final reveal so per-profile rarity and variant names stay deterministic across synchronized clients.
- Migrated spell-class discovery to the D&D 5e Spell List Registry when available, including spell lists registered by the official Player's Handbook module.
- Added `createScrollFromCompendiumSpell` support with existing scroll creation fallbacks preserved.
- Added transactional cleanup when modern enchantment application fails.
- Added a read-only D&D 5e 6 diagnostics probe at `tools/dnd6-probe.mjs`.
- Expanded compatibility documentation and regression coverage for template profiles, riders, generic base forms, fixed-form weapons, and PHB spell lists.
- Kept the manifest D&D 5e `verified` value at 5.3.3 until the 6.0.3 runtime regression checklist is completed in Foundry.

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
