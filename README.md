Follow for more... https://www.patreon.com/EasyModules

# EasyMagicItems

EasyMagicItems provides a fast, immersive, and cinematic way to generate and distribute balanced magic items in Foundry Virtual Tabletop, with advanced filters, player-specific recommendations, and seamless integration with the D&D 5e system.

Each participating character receives a personalized item pool based on class, level, proficiencies, equipment, and progression. The GM controls the pace of the draw while players take part in the reveal.

## Features

- Synchronized magic-item reveals for up to six characters.
- Card-by-card cinematic opening with individual arrival, flip, glow, and audio cues.
- Character-aware recommendations focused on items that are useful for each character.
- Fully configurable item pools for guided or completely random rewards.
- Independent reveal control for each player.
- Automatic handling of compatible magic-item forms (weapons, armor, shields, ammunition, and other official templates) and spell scrolls.
- Optional automatic delivery to character inventories.
- Optional chat summaries and cinematic audio.
- Separate controls for all audio and for the opening theme alone.
- Optional integration with the EasyModules Hub.

## Requirements

- Foundry Virtual Tabletop v13 through v14.
- D&D 5e system 5.3.0 or newer. A D&D 5e 6.x compatibility path is included and requires the Foundry version required by that system release; it remains pending functional regression validation.
- EasyModules Hub 1.0.8 or newer (optional).
- Compatible D&D 5e compendiums installed and enabled.

EasyMagicItems reads items, artwork, portraits, and game data from the user's installed compendiums at runtime. No D&D game content is bundled with the module.

## Installation

Paste this manifest URL into Foundry VTT's **Install Module** manifest field:

```text
https://github.com/EasyModules/EasyMagicItems/releases/latest/download/module.json
```

After installation:

1. Enable EasyMagicItems in the world. EasyModules Hub is optional and adds centralized access when enabled.
2. Select one to six player-character tokens.
3. Launch EasyMagicItems from the EasyModules Hub or its provided macro entry point.
4. Review the item pools and begin the draw.

## Settings

EasyMagicItems includes a dedicated configuration window using the same visual language as the EasyModules suite. Settings are grouped into three focused sections:

- **Draw Defaults** — choose whether new participants begin with the character-aware recommended pool or the broad item pool.
- **Delivery** — control automatic inventory delivery and the final group summary posted to chat.
- **Cinematic** — control all EasyMagicItems audio or mute only the opening theme.

World settings are shared by the table. Audio preferences are stored locally for each user/device. Disabling **Enable all cinematic audio** silences everything; disabling only **Play the opening theme** keeps card and interface sounds active. The configuration window also includes a non-destructive **Restore defaults** action: values are not persisted until **Save Settings** is pressed.

## Compatibility and Maintenance

EasyMagicItems supports the existing D&D 5e 5.3.x path and includes capability-based compatibility for D&D 5e 6.x. D&D 5e 6.0.3 itself requires Foundry v14.367 or newer. The manifest keeps D&D 5e 5.3.3 as verified until the runtime regression suite is completed in a clean 6.0.3 world.

EasyMagicItems isolates its most update-sensitive integrations, including compendium indexing, rarity schema differences, D&D 5e Spell List Registry discovery, spell-scroll creation, official Enchant activities/profiles/riders, Foundry sockets, and application rendering.

Version 1.1.0 enforces an item-resolution invariant: variants such as resistance type, enchantment profile, creature target, carpet size, golem type, prayer beads, robe patches, and starting treasure quantities are resolved before an item can be added to an Actor. Items whose mandatory found-state cannot yet be represented safely are excluded from the draw pool rather than delivered incomplete.

See `COMPATIBILITY.md` for the full compatibility assessment and regression checklist.

## D&D 5e 6.x diagnostic probe

Version 1.1.0 includes a read-only diagnostic probe at `tools/dnd6-probe.mjs`. In a temporary Foundry Script macro, run:

```js
await import(`/modules/easy-magic-items/tools/dnd6-probe.mjs?${Date.now()}`);
```

The probe rebuilds indexes and checks template/profile discovery, the D&D 5e Spell List Registry, the official PHB registration path, scroll helpers, EnchantActivity methods, and the D&D 5e 6 rider API. It does not create, update, or delete actor items. Runtime item creation still needs the regression tests in `TESTING-DND6.md`.

## Support

Report bugs through the [EasyMagicItems issue tracker](https://github.com/EasyModules/EasyMagicItems/issues).

## Development

EasyMagicItems is developed and maintained by EasyModules with AI-assisted implementation and code review. Release decisions, testing, licensing, and maintenance remain the responsibility of EasyModules.

## Credits and License

EasyMagicItems is distributed under the terms in `LICENSE`. Third-party asset credits, license details, and trademark notices are documented in `CREDITS.md`, `THIRD_PARTY_ASSETS.md`, and `THIRD_PARTY_NOTICES.md`.
