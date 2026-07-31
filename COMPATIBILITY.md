# EasyMagicItems 1.0.0 — Compatibility and Update Fragility Report

## Scope

This report evaluates the module against small Foundry updates, major Foundry releases, D&D 5e system updates, EasyModules updates, compendium changes, and third-party module interactions.

## Risk summary

| Update type | Risk | Main reason |
|---|---:|---|
| Small Foundry v14 updates | Low to moderate | Legacy `Application`, socket lifecycle, chat rendering hook, and document sheet rendering |
| New major Foundry version | Moderate to high | Legacy `Application` may be removed or materially changed; scene/token and sheet APIs may move |
| Small D&D 5e 5.3.x updates | Moderate | Item schemas, enchantment effects, spell metadata, and scroll generation helper |
| New major D&D 5e version | High | Compendium IDs, item schema, activity/enchantment format, class/proficiency data, and scroll API |
| EasyModules updates | Low | Integration uses a small public API surface; minimum supported version is 1.0.0 |
| Official compendium content updates | Moderate | Item names, pack IDs, rarity/type fields, source metadata, and spell class metadata may change |
| Third-party compendium updates | Low | The module primarily targets official `dnd5e.*` packs and ignores unrelated packs |
| Other module updates | Low | No monkey patches or direct dependencies on third-party modules |

## Most fragile integrations

### 1. Legacy Foundry Application

The cinematic draw window still extends the legacy `Application` class. It is functional for Foundry v14, but this is the largest Foundry-major-version risk. A future migration should move the UI to `ApplicationV2` while preserving the current template and event contract.

### 2. D&D 5e scroll creation

`dnd5e.documents.Item5e.createScrollFromSpell` is a system helper rather than a stable cross-system Foundry API. The module has a fallback that clones the scroll template, but a system schema change may require updating both paths.

### 3. Weapon enchantment materialization

The module combines a base weapon with activities and Active Effects from an official magic-item template. Changes to `system.activities`, enchantment effect types, effect origins, or embedded effect behavior can affect final weapons. Version 1.0.0 now cleans up partial items when this process fails.

### 4. Compendium IDs and schemas

The primary packs are currently `dnd5e.items` and `dnd5e.equipment24`. Small content updates are usually safe, but renaming either pack or changing rarity, type, base item, property, source, class, school, or level fields can reduce or empty pools.

### 5. Recommendation parsing

Some class restrictions and spellcaster requirements are inferred from English item descriptions. This is intentionally conservative, but localized or rewritten descriptions may reduce recommendation accuracy without breaking the draw itself.

### 6. Socket synchronization

The module uses Foundry's native module socket. Game-state mutations remain GM-authoritative and sender ownership is checked. Native sockets do not provide cryptographic sender authentication, so this is appropriate for a normal trusted game table, not a hostile multi-user environment.

## Hardening implemented in 1.0.0

- Shared in-flight catalog build promise prevents duplicate indexing work.
- Individual pack indexing failures are isolated.
- Empty or unavailable catalog states produce explicit errors.
- Catalog invalidation is exposed publicly and reacts to relevant document/compendium changes.
- Reveal and finalization state always clears through `finally` blocks.
- Failed reveals do not remain permanently locked.
- Weapon creation behaves transactionally and cleans up partial inventory documents.
- Enchantment effects are created in one batch instead of one document at a time.
- Public API now exposes its version.

## Recommended regression tests

1. Start a draw with one and six player characters.
2. Start two catalog rebuild requests in rapid succession and confirm only one effective build completes.
3. Disable one official item pack and verify the remaining source still works.
4. Disable both supported item packs and verify a clear error appears.
5. Reveal a normal permanent item with automatic delivery enabled and disabled.
6. Reveal a consumable item and confirm its source data is preserved.
7. Reveal and finalize a magic weapon, then inspect name, activities, effects, image, and inventory ownership.
8. Force an enchantment creation failure and confirm no partial weapon remains.
9. Reveal and finalize spell scrolls at several levels and with class/school filters.
10. Reroll an automatically granted item and confirm only the module-granted copy is removed.
11. Test player-owned reveal permissions and GM lock/release behavior.
12. Test close, reconnect, and synchronized rendering with GM and player clients.
13. Open every result sheet from both GM and player accounts.
14. Verify chat summary creation and native chest branding.
15. Update or replace a compendium and confirm rebuilding the catalog reflects the change.

## Upgrade policy

Do not increase the manifest `verified` Foundry or D&D 5e versions based only on static inspection. Run the regression checklist in a clean test world first. For any new major Foundry or D&D 5e release, prioritize Application compatibility, scroll generation, enchantment materialization, actor class/proficiency fields, and official compendium IDs.
