# EasyMagicItems
follow for more... https://www.patreon.com/EasyModules

EasyMagicItems creates a cinematic, synchronized magic-item draw experience for Foundry Virtual Tabletop using the D&D 5e system.

Each participating character receives a personalized item pool based on class, level, proficiencies, equipment, and progression. The GM controls the pace of the draw while players take part in the reveal.

## Features

- Synchronized magic-item reveals for up to six characters.
- Character-aware recommendations focused on items that are useful for each character.
- Fully configurable item pools for guided or completely random rewards.
- Independent reveal control for each player.
- Automatic handling of compatible weapon forms and spell scrolls.
- Optional automatic delivery to character inventories.
- Optional chat summaries and cinematic sound effects.
- Integration with the EasyModules Hub.

## Requirements

- Foundry Virtual Tabletop v14.
- D&D 5e system 5.3.0 or newer.
- EasyModules 1.0.0 or newer.
- Compatible D&D 5e compendiums installed and enabled.

EasyMagicItems reads items, artwork, portraits, and game data from the user's installed compendiums at runtime. No D&D game content is bundled with the module.

## Installation

Install EasyMagicItems using the manifest link supplied through the official EasyModules Patreon distribution. Foundry will identify EasyModules as a required dependency and can locate its public manifest automatically.

After installation:

1. Enable EasyModules and EasyMagicItems in the world.
2. Select one to six player-character tokens.
3. Launch EasyMagicItems from the EasyModules Hub or its provided macro entry point.
4. Review the item pools and begin the draw.

## Settings

EasyMagicItems includes options for:

- Character-aware recommended item pools.
- Per-character item filters.
- Automatic inventory delivery.
- Chat summaries.
- Optional sound effects.

Sound preferences are stored locally, allowing each user to enable or disable audio independently.

## Compatibility and Maintenance

EasyMagicItems isolates its most update-sensitive integrations, including compendium indexing, D&D 5e spell-scroll creation, weapon enchantment materialization, Foundry sockets, and application rendering.

See `COMPATIBILITY.md` for the full compatibility assessment and regression checklist.

## Support

Support development and access EasyModules releases and report bugs through [Patreon](https://www.patreon.com/EasyModules).

## Credits and License

EasyMagicItems is distributed under the terms in `LICENSE`.

Third-party asset credits, license details, and trademark notices are documented in:

- `CREDITS.md`
- `THIRD_PARTY_ASSETS.md`
- `THIRD_PARTY_NOTICES.md`
