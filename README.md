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
- Automatic handling of compatible weapon forms and spell scrolls.
- Optional automatic delivery to character inventories.
- Optional chat summaries and cinematic audio.
- Separate controls for all audio and for the opening theme alone.
- Required integration with the EasyModules Hub.

## Requirements

- Foundry Virtual Tabletop v13 through v14.
- D&D 5e system 5.3.0 or newer.
- EasyModules Hub 1.0.6 or newer (required).
- Compatible D&D 5e compendiums installed and enabled.

EasyMagicItems reads items, artwork, portraits, and game data from the user's installed compendiums at runtime. No D&D game content is bundled with the module.

## Installation

Paste this manifest URL into Foundry VTT's **Install Module** manifest field:

```text
https://github.com/EasyModules/EasyMagicItems/releases/latest/download/module.json
```

After installation:

1. Enable EasyModules Hub and EasyMagicItems in the world.
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

EasyMagicItems supports Foundry VTT v13 through v14.364. The v14.364 build is the verified release target; v13 support is provided through the same public APIs and guarded compatibility paths.

EasyMagicItems isolates its most update-sensitive integrations, including compendium indexing, D&D 5e spell-scroll creation, weapon enchantment materialization, Foundry sockets, and application rendering.

See `COMPATIBILITY.md` for the full compatibility assessment and regression checklist.

## Support

Report bugs through the [EasyMagicItems issue tracker](https://github.com/EasyModules/EasyMagicItems/issues).

## Development

EasyMagicItems is developed and maintained by EasyModules with AI-assisted implementation and code review. Release decisions, testing, licensing, and maintenance remain the responsibility of EasyModules.

## Credits and License

EasyMagicItems is distributed under the terms in `LICENSE`. Third-party asset credits, license details, and trademark notices are documented in `CREDITS.md`, `THIRD_PARTY_ASSETS.md`, and `THIRD_PARTY_NOTICES.md`.
