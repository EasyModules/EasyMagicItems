# EasyMagicItems 1.1.0 — D&D 5e 6.0.3 Runtime Test Plan

Use a disposable or backed-up test world. Target for this build: Foundry v14.367 with D&D 5e 6.0.3. Keep automatic delivery ON for the inventory tests unless a step says otherwise.

## 1. Read-only preflight

Create a temporary Script macro and run:

```js
await import(`/modules/easy-magic-items/tools/dnd6-probe.mjs?${Date.now()}`);
```

Expected:

- no FAIL rows;
- 36 official setup templates detected in the supplied 6.0.3 content set;
- the resolution-gate checks recognize the modern variant families;
- 12 legacy Armor of Resistance forms are routed through legacy resolution when the SRD pack is present;
- Ring of Spell Storing is reported as intentionally guarded/excluded;
- the official Ring of Resistance table mismatch is detected without being treated as a module failure;
- the Slaying table reports non-uniform 1d100 bands.

The probe is read-only and does not create or modify actor items.

## 2. Ordinary item regression

Draw a normal ready item that has no acquisition-time choices.

Expected: one normal item is delivered exactly as before. Repeat once with automatic delivery OFF and confirm no Actor mutation occurs.

## 3. Armor of Resistance 2024 — critical resolution test

Reveal **Armor of Resistance** from the 2024 source and finish the base-armor step.

Expected:

- one resistance is reserved before inventory delivery;
- only compatible armor bases are offered;
- the final name identifies the resolved resistance/form;
- exactly one resistance is mechanically present;
- no generic Armor of Resistance template remains in the Actor;
- `flags.easy-magic-items.resolution.complete` is true on the delivered item.

Repeat at least twice to exercise different variants.

## 4. Legacy Armor of Resistance

Use the legacy SRD source and reveal one pre-formed armor such as **Breastplate Armor of Resistance**.

Expected:

- the existing armor form is preserved;
- a resistance type is rolled from the legacy table;
- a real transferable Active Effect adds that resistance;
- the final item is renamed to make the resistance explicit;
- no raw "choose the resistance later" armor is delivered.

## 5. Ring of Resistance — malformed official-table defense

Reveal **Ring of Resistance** several times.

Expected:

- exactly one of the ten resistance profiles is applied;
- the item never receives a mechanically different resistance from the reserved result;
- Cold and Poison remain possible even though the supplied official table contains bad UUID references;
- no duplicate resistance profiles are applied.

The read-only probe should also report the known official label/UUID mismatch as handled content corruption.

## 6. Potion of Resistance

Reveal **Potion of Resistance**.

Expected:

- exactly one damage type is selected;
- the delivered Item keeps only the matching resistance Active Effect;
- Drink Potion references only that selected effect;
- the final name identifies the resistance.

## 7. Weighted Ammunition of Slaying

Reveal **Ammunition of Slaying** repeatedly or temporarily narrow the pool to it.

Expected:

- the profile follows the official 1d100 RollTable rather than uniform 1/14 selection;
- the selected creature type matches the resulting enchantment mechanically;
- only one Slaying profile is applied.

The probe verifies that the installed table still has non-uniform bands totaling 100.

## 8. +1/+2/+3 profile locking

Test **Weapon, +1, +2, or +3** with the rarity filter restricted separately to Uncommon, Rare, and Very Rare.

Expected:

- Uncommon -> +1;
- Rare -> +2;
- Very Rare -> +3;
- the profile is already reserved before the mundane form is selected;
- if the reserved profile were missing/invalid, finalization fails instead of selecting another profile at grant time.

Repeat one case with Armor, Shield, Ammunition, or Wand of the War Mage if convenient.

## 9. Flame Tongue rider regression

Reveal **Flame Tongue** and materialize it on a valid melee weapon.

Expected:

- the primary enchantment is applied once through the system API;
- the **Engulf in Flames** rider activity exists on the final item;
- the item has no duplicate setup enchantments/effects;
- the resolved-item flag is complete.

## 10. Carpet of Flying and Manual of Golems

Test both.

Expected for Carpet:

- the official weighted size table is rolled;
- only the activity for that size remains;
- the final name includes the selected size.

Expected for Manual:

- one golem type is rolled;
- only the matching Create Golem activity remains in the 2024 document;
- the final name identifies the golem type.

The legacy Manual should also resolve a golem type instead of remaining generic.

## 11. Ring of Elemental Command

Reveal the generic **Ring of Elemental Command** from the 2024 source.

Expected:

- it resolves to one complete Air/Earth/Fire/Water ring document;
- the generic parent is never delivered;
- the four concrete support documents are not independently double-counted in the draw pool.

## 12. Necklace of Prayer Beads

Test 2024 and, if practical, legacy 2014.

Expected:

- the necklace contains exactly 1d4+2 magic beads;
- each bead type follows the official d20 table;
- absent bead activities are removed;
- duplicate bead types increase the appropriate usage count;
- daily recovery remains dawn-based;
- in the legacy item, Cure Wounds and Lesser Restoration share the Curing bead Item-use pool rather than receiving independent duplicate uses.

## 13. Robe of Useful Items

Reveal **Robe of Useful Items**.

Expected:

- the six fixed patch types remain at two each;
- 4d4 additional patches are rolled from the official d100 table;
- repeated patch results are aggregated into counts;
- a rolled Spell Scroll patch is resolved to a concrete level 1-3 spell instead of remaining "choose a spell later";
- the final item contains a resolution summary and no unresolved patch instruction.

## 14. Starting treasure quantities

Test at least **Bag of Beans** and **Deck of Illusions**. If available, also test Sovereign Glue/Universal Solvent.

Expected:

- Bag of Beans receives a rolled 3d4 starting count and no longer needs the Count Beans initialization activity;
- Deck of Illusions receives 34-(1d20-1) usable cards and no Count Number of Cards initialization activity;
- Sovereign Glue and 2024 Universal Solvent receive 1d6+1 ounces;
- the legacy Deck of Many Things resolves to 13 cards (75%) or 22 cards (25%).

## 15. Guarded unsupported content

Search/narrow the pool for **Ring of Spell Storing**.

Expected: it is not a candidate. The module deliberately excludes it until the mandatory initially stored spells can be represented correctly. It must never be delivered as an empty/unresolved treasure result.

## 16. Failure / rollback

Cause a safe finalization failure in a disposable world (for example an incompatible base override if possible).

Expected:

- no partially materialized Item remains;
- no alternate profile is silently selected;
- the player can retry after the problem is corrected.

## 17. Backward-compatibility smoke test

In a D&D 5e 5.3.3 test world, verify at minimum:

- ordinary ready item;
- legacy Armor of Resistance;
- one template weapon such as Flame Tongue;
- Necklace of Prayer Beads;
- one spell scroll.

## Release gate

Do not raise D&D 5e `verified` to 6.0.3 until the probe has no failures and the critical runtime cases above pass. After runtime verification, update the exact Foundry/D&D versions tested and only then prepare the stable 1.1.0 release.

## test5 profile-hydration regression gate

The read-only probe must report **0 failures** for the official profile matrix. In particular:

- Template discovery should detect the complete official setup-enchantment set when the full SRD 2024 pack is installed (36 in the July 2026 reference export).
- Armor of Resistance and Ring of Resistance must resolve as `profile-table`, not generic `template`.
- Weapon +1/+2/+3 = 3 profiles / 3 materializing.
- Armor of Resistance = 10 / 10.
- Dragon Scale Mail = 10 / 10.
- Ammunition of Slaying = 14 / 14.
- Hammer of Thunderbolts = 2 total / 1 materializing.
- Flame Tongue = 1 / 1.
