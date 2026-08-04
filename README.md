Follow for more... https://www.patreon.com/EasyModules

# EasyMagicItems

EasyMagicItems creates a cinematic, synchronized magic-item draw experience for Foundry Virtual Tabletop using the D&D 5e system.

Each participating character receives a personalized item pool based on class, level, proficiencies, equipment, and progression. The GM controls the pace of the draw while players take part in the reveal.

## Features

- Synchronized magic-item reveals for up to six characters.
- Card-by-card cinematic opening with individual arrival, flip, glow, and audio cues.
- Character-aware recommendations focused on items that are useful for each character.
- Fully configurable item pools for guided or completely random rewards.
- Independent reveal control for each player.
- Automatic handling of compatible weapon forms and spell scrolls.
- Optional automatic delivery to character inventories.
- Optional chat summaries and cinematic audio.
- Separate controls for all audio and for the opening theme alone.
- Integration with the EasyModules Hub.

## Requirements

- Foundry Virtual Tabletop v14.
- D&D 5e system 5.3.0 or newer.
- EasyModules 1.0.0 or newer.
- Compatible D&D 5e compendiums installed and enabled.

EasyMagicItems reads items, artwork, portraits, and game data from the user's installed compendiums at runtime. No D&D game content is bundled with the module.

## Installation

Paste this manifest URL into Foundry VTT's **Install Module** manifest field:

```text
https://github.com/EasyModules/EasyMagicItems/releases/latest/download/module.json
```

After installation:

1. Enable EasyModules and EasyMagicItems in the world.
2. Select one to six player-character tokens.
3. Launch EasyMagicItems from the EasyModules Hub or its provided macro entry point.
4. Review the item pools and begin the draw.

## Settings

EasyMagicItems includes options for character-aware pools, per-character filters, automatic inventory delivery, chat summaries, all cinematic audio, and the opening theme.

Audio preferences are stored locally for each user. Disabling **Enable all cinematic audio** silences everything. Disabling only **Play the opening theme** keeps the card and interface effects while muting the music.

## Compatibility and Maintenance

EasyMagicItems isolates its most update-sensitive integrations, including compendium indexing, D&D 5e spell-scroll creation, weapon enchantment materialization, Foundry sockets, and application rendering.

See `COMPATIBILITY.md` for the full compatibility assessment and regression checklist.

## Support

Report bugs through the [EasyMagicItems issue tracker](https://github.com/EasyModules/EasyMagicItems/issues).

## Development

EasyMagicItems is developed and maintained by EasyModules with AI-assisted implementation and code review. Release decisions, testing, licensing, and maintenance remain the responsibility of EasyModules.

## Credits and License

EasyMagicItems is distributed under the terms in `LICENSE`. Third-party asset credits, license details, and trademark notices are documented in `CREDITS.md`, `THIRD_PARTY_ASSETS.md`, and `THIRD_PARTY_NOTICES.md`.
