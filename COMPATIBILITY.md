# EasyMagicItems 1.1.0 — Compatibility and Update Fragility Report

## Current support state

This release preserves the D&D 5e 5.3.x path and adds capability-based support for D&D 5e 6.x. Static validation was performed against D&D 5e 6.0.3 and the official Player's Handbook module supplied for the audit. Runtime verification in a clean Foundry world is still required before increasing the manifest `verified` value above D&D 5e 5.3.3.

D&D 5e 6.0.3 requires Foundry v14.367 or newer. EasyMagicItems itself still avoids hard-coding that Foundry minimum so the 5.3.x branch can continue to load on supported older v13/v14 installations.

## Risk summary

| Update type | Risk | Main reason |
|---|---:|---|
| Small Foundry v13/v14 updates | Low to moderate | Legacy `Application`, sockets, chat rendering, and item document lifecycle |
| New major Foundry version | Moderate to high | Legacy `Application` may move or be removed |
| D&D 5e 5.3.x updates | Low to moderate | Legacy rider API and compendium schema |
| D&D 5e 6.x updates | Moderate | EnchantActivity/profile/rider APIs and registry schemas |
| Official 2024 compendium updates | Moderate | Template/profile structure, base references, pack IDs, and metadata |
| Official PHB updates | Low to moderate | Spell-list registry declarations and UUIDs |
| EasyModules updates | Low | Optional integration uses a small API surface |
| Third-party module updates | Low | No monkey patches; item creation remains system-driven |

## D&D 5e 6 hardening in 1.1.0

### Rarity adapter

Catalog indexing reads both legacy `system.rarity` and modern `system.rarities`. Profile-defined rarities are also indexed, allowing template items such as +1/+2/+3 weapons and armor to remain discoverable even when the parent template has no direct rarity.

### Profile-aware template discovery

EasyMagicItems no longer assumes that the presence of an enchantment Active Effect means the item is a construction template. It identifies official hidden, external Enchant activities and keeps playable/self enchantments on ready-to-use items.

This prevents items such as Dagger of Venom, Oil of Sharpness, and Helm of Brilliance from being misclassified as generic construction templates.

### Generic materializer

Weapon-only construction has been replaced by a generic materialization path. Supported official templates can resolve compatible base weapons, armor, shields, ammunition, rings, wands, and other forms without duplicating a separate creation implementation for each category.

Base resolution uses, in order:

1. explicit official Item UUID references when available;
2. declared base-item identifiers;
3. structured item/category data;
4. conservative description heuristics only as a fallback;
5. the D&D 5e `canEnchant` validation before mutation.

### EnchantActivity API

On D&D 5e 6.x, EasyMagicItems calls the system's `canEnchant` and `applyEnchantment` APIs rather than copying every enchantment Active Effect from the template.

After the selected profile is applied, riders are materialized through `effect.system.collectRiders()` plus `foundry.documents.modifyBatch()` when available. D&D 5e 5.3.x keeps the older rider helper as a capability-based fallback.

### Supplemental profiles

Profiles that do not themselves materialize the mundane base are not treated as independent item variants when a materializing profile exists. This prevents supplemental states such as Hammer of Thunderbolts' paired-attunement profile from replacing the actual Hammer profile during the draw.

Profiles that represent genuine variants remain available. Static fixtures confirmed the expected distinction for +1/+2/+3 items, Armor/Ring of Resistance, Dragon Scale Mail, and Ammunition of Slaying.

### Spell lists and PHB support

When available, spell selection uses `dnd5e.registry.spellLists` rather than `system.sourceClass`. This supports the D&D 5e 6 schema and spell lists registered by the official Player's Handbook module. Legacy compendium metadata remains as a fallback for older systems.

Scroll creation prefers `Item5e.createScrollFromCompendiumSpell`, then `createScrollFromSpell`, then the existing manual fallback.

### Transaction safety

If enchantment application fails after creating the mundane base item, EasyMagicItems removes that partial item and leaves the result pending so the finalization can be retried. Rider materialization is delegated to system batch operations when available.


## Item-resolution hardening in 1.1.0

The release adds a stricter invariant on top of the 6.x enchantment work: a source Item that requires an acquisition-time choice may not be added to an Actor until that choice is reserved and the resulting document passes validation. The final grant path no longer invents a missing enchantment profile as a fallback.

Resolution is data-driven where the official content exposes enough structure:

1. official RollTables preserve weighted probabilities;
2. semantic tokens identify the conceptual result (damage type, creature type, golem, size, dragon, etc.);
3. the resolver validates the selected profile/effect/activity against its actual mechanical changes;
4. malformed UUID references are treated as hints, not unquestioned authority;
5. only a validated resolved document may pass the inventory gate.

The supplied D&D 5e 6.0.3 content contains malformed Ring of Resistance table references (including a Fire row pointing at Cold and a Poison row pointing at Necrotic). The resolver therefore reconciles the entire table/profile set one-to-one before using a row. Damage-type values are also normalized before delivery, including the observed `bludegoning` typo in Armor of Vulnerability content.

The build resolves modern multi-profile templates plus ready-item variants such as Potion of Resistance, Carpet of Flying, Manual of Golems, Ring of Elemental Command, Necklace of Prayer Beads, and Robe of Useful Items. It also resolves their relevant legacy SRD counterparts, including all twelve pre-formed Armor of Resistance documents. Simple found-state quantities (beans, cards, glue/solvent ounces) are initialized before delivery.

Ring of Spell Storing remains a guarded unsupported case because its mandatory found-state consists of actual stored spells rather than a scalar/profile choice. Both legacy and 2024 sources are excluded from candidate pools until that state can be represented correctly; they are not delivered raw.

## Static regression findings

The supplied 2024 equipment fixture contains 36 setup templates recognized by the new resolver. The profile heuristic found only one supplemental/non-materializing profile among those templates: Hammer of Thunderbolts' paired-attunement bonus. Key profile counts validated statically include:

- Weapon +1/+2/+3: 3 materializing profiles.
- Armor of Resistance: 10 materializing profiles.
- Dragon Scale Mail: 10 materializing profiles.
- Ammunition of Slaying: 14 materializing profiles.
- Hammer of Thunderbolts: 2 total profiles, 1 materializing profile.
- Flame Tongue: 1 primary materializing profile with a rider activity.

The base-form resolver produced at least one compatible base for every recognized setup template in the supplied fixture.

## Remaining runtime risks

Static inspection cannot prove that Foundry document lifecycle hooks, ActiveEffect preparation, rider batch creation, ownership, or synchronized player/GM interactions behave correctly in the live world. The release therefore does not raise the manifest D&D 5e `verified` value yet.

The highest-value runtime cases are Flame Tongue, Hammer of Thunderbolts, one +1/+2/+3 weapon, one generic armor template, Armor of Resistance, a fixed-form weapon, and a PHB-only spell scroll.

## Probe

A read-only diagnostic probe is bundled at `tools/dnd6-probe.mjs`. Run it from a temporary Script macro with:

```js
await import(`/modules/easy-magic-items/tools/dnd6-probe.mjs?${Date.now()}`);
```

The probe does not mutate actor inventories. It rebuilds indexes and checks the registry, template/profile discovery, PHB spell registration, scroll helpers, EnchantActivity methods, and the D&D 5e 6 rider API.

## Upgrade policy

Do not increase the manifest Foundry or D&D 5e `verified` values based only on static inspection. Complete `TESTING-DND6.md` in a clean 6.0.3 test world first. For later D&D 5e releases, retest rarity schemas, EnchantActivity application, rider materialization, spell-list registration, scroll creation, and official pack IDs before changing the compatibility declaration.
