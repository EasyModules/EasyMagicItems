const MODULE_ID = "easy-magic-items";
const SOCKET_NAME = `module.${MODULE_ID}`;
const TEMPLATE = `modules/${MODULE_ID}/templates/draw.hbs`;
const MAX_PARTICIPANTS = 6;
const CLOSE_FADE_MS = 350;
const CARD_SEQUENCE_DELAY_MS = 450;
const CARD_SEQUENCE_INTERVAL_MS = 300;
const CARD_FLIP_SOUND_OFFSET_MS = 180;
const CARD_ENTRY_SETTLE_MS = 1380;
const INTRO_TAIL_MS = 1250;
const START_SYNC_BUFFER_MS = 650;
const REVEAL_DELAY_MS = 1750;
const FINAL_REVEAL_DELAY_MS = 1750;

const SETTINGS = {
  AUTO_GRANT: "autoGrant",
  POST_TO_CHAT: "postToChat",
  RECOMMENDED_BY_DEFAULT: "recommendedPoolsByDefault",
  SOUND_ENABLED: "soundEnabled",
  OPENING_THEME_ENABLED: "openingThemeEnabled"
};

const SPELL_CLASSES = ["bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "warlock", "wizard"];
const SPELL_SCHOOLS = ["abj", "con", "div", "enc", "evo", "ill", "nec", "trs"];
const FULL_CASTERS = new Set(["bard", "cleric", "druid", "sorcerer", "warlock", "wizard"]);
const HALF_CASTERS = new Set(["artificer", "paladin", "ranger"]);

const PACKS = [
  { id: "dnd5e.items", labelKey: "EMI.Source.SRDItems", priority: 1 },
  { id: "dnd5e.equipment24", labelKey: "EMI.Source.Equipment2024", priority: 2 }
];

const sessions = new Map();
const applications = new Map();
let catalogCache = null;
let catalogBuildPromise = null;
let scrollCreationQueue = Promise.resolve();

const RARITIES = ["common", "uncommon", "rare", "veryRare", "legendary", "artifact"];

const CATEGORIES = ["weapon", "armor", "shield", "staff", "wand", "rod", "ring", "potion", "scroll", "ammunition", "wondrous"];

const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
const PHYSICAL_DAMAGE_TYPES = ["bludgeoning", "piercing", "slashing"];
const CREATURE_TYPES = ["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"];
const DRAGON_VARIANTS = [
  { key: "black", damage: "acid" }, { key: "blue", damage: "lightning" }, { key: "brass", damage: "fire" },
  { key: "bronze", damage: "lightning" }, { key: "copper", damage: "acid" }, { key: "gold", damage: "fire" },
  { key: "green", damage: "poison" }, { key: "red", damage: "fire" }, { key: "silver", damage: "cold" },
  { key: "white", damage: "cold" }
];
const DAMAGE_ALIASES = new Map([
  ["bludegoning", "bludgeoning"],
  ["bludgeonning", "bludgeoning"],
  ["bludgeoning", "bludgeoning"]
]);

function i18n(key, fallback = key) {
  const localized = game.i18n.localize(key);
  return localized === key ? fallback : localized;
}

function i18nFormat(key, data = {}, fallback = key) {
  const localized = game.i18n.format(key, data);
  if (localized !== key) return localized;
  return String(fallback).replace(/\{(\w+)\}/g, (_match, token) => data[token] ?? `{${token}}`);
}

function wait(ms) {
  return new Promise(resolve => window.setTimeout(resolve, Math.max(0, ms)));
}

function rarityLabel(key) {
  return i18n(`EMI.Rarity.${key}`);
}

function categoryLabel(key) {
  return i18n(`EMI.Category.${key}`);
}

function schoolLabel(key) {
  return i18n(`EMI.School.${key}`);
}

function classLabel(key) {
  return i18n(`EMI.Class.${key}`);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeName(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getValue(entry, path, fallback = undefined) {
  return foundry.utils.getProperty(entry, path) ?? fallback;
}

function collectionValues(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (raw instanceof Set) return [...raw];
  if (raw instanceof Map) return [...raw.values()];
  if (typeof raw.values === "function") {
    try { return [...raw.values()]; } catch (_error) { /* continue */ }
  }
  if (typeof raw === "object") return Object.values(raw);
  // Effects, activities and rider collections are collection-shaped. A
  // primitive here indicates malformed source data, not a one-entry list.
  return [];
}

function stringSet(raw) {
  if (raw === null || raw === undefined || raw === "") return [];
  if (typeof raw === "string") return raw.split(/[;,|]/).map(v => v.trim()).filter(Boolean);
  if (Array.isArray(raw) || raw instanceof Set) return [...raw].map(String).filter(Boolean);
  if (typeof raw === "object") {
    return Object.entries(raw)
      .filter(([, enabled]) => enabled === true || typeof enabled === "string" || typeof enabled === "number")
      .map(([key, enabled]) => enabled === true ? key : String(enabled))
      .filter(Boolean);
  }
  return [String(raw)];
}

function getProperties(entry) {
  return stringSet(getValue(entry, "system.properties", []));
}

function getItemRarities(entry) {
  const modern = stringSet(getValue(entry, "system.rarities", []));
  const legacy = stringSet(getValue(entry, "system.rarity", ""));
  return [...new Set([...modern, ...legacy].filter(rarity => RARITIES.includes(rarity)))];
}

function normalizeDamageType(value) {
  const normalized = normalizeName(value).replace(/[^a-z]/g, "");
  const aliased = DAMAGE_ALIASES.get(normalized) ?? normalized;
  return DAMAGE_TYPES.includes(aliased) ? aliased : null;
}

function titleCase(value) {
  return String(value ?? "").replace(/\b\w/g, match => match.toUpperCase());
}

function stripFoundryLinks(value) {
  return String(value ?? "")
    .replace(/@UUID\[[^\]]+\](?:\{([^}]*)\})?/gi, (_m, label) => label ?? "")
    .replace(/@Embed\[[^\]]+\](?:\{([^}]*)\})?/gi, (_m, label) => label ?? "")
    .replace(/@UUID\[[^\]]+\]/gi, "")
    .replace(/\[\[\/award\s+([^\]]+)\]\]/gi, "$1");
}

function semanticTokensFromText(value) {
  const raw = normalizeName(stripFoundryLinks(value))
    .replace(/[×]/g, "x")
    .replace(/\s+/g, " ");
  const tokens = new Set();

  for (const type of DAMAGE_TYPES) {
    const aliases = type === "bludgeoning" ? ["bludgeoning", "bludegoning", "bludgeonning"] : [type];
    if (aliases.some(alias => new RegExp(`\\b${alias}\\b`, "i").test(raw))) tokens.add(`damage:${type}`);
  }

  const creatureAliases = {
    aberration: ["aberration", "aberrations"], beast: ["beast", "beasts"], celestial: ["celestial", "celestials"],
    construct: ["construct", "constructs"], dragon: ["dragon", "dragons"], elemental: ["elemental", "elementals"],
    fey: ["fey"], fiend: ["fiend", "fiends"], giant: ["giant", "giants"], humanoid: ["humanoid", "humanoids"],
    monstrosity: ["monstrosity", "monstrosities"], ooze: ["ooze", "oozes"], plant: ["plant", "plants"], undead: ["undead"]
  };
  for (const [type, aliases] of Object.entries(creatureAliases)) {
    if (aliases.some(alias => new RegExp(`\\b${alias}\\b`, "i").test(raw))) tokens.add(`creature:${type}`);
  }

  for (const { key } of DRAGON_VARIANTS) {
    if (new RegExp(`\\b${key}\\b`, "i").test(raw)) tokens.add(`dragon:${key}`);
  }

  for (const golem of ["clay", "flesh", "iron", "stone"]) {
    if (new RegExp(`\\b${golem}\\s+golem\\b`, "i").test(raw)) tokens.add(`golem:${golem}`);
  }

  for (const plane of ["air", "earth", "fire", "water"]) {
    if (new RegExp(`\\b${plane}\\s+ring\\b|\\bring[^.]{0,40}\\b${plane}\\b`, "i").test(raw)) tokens.add(`element:${plane}`);
  }

  for (const bead of ["blessing", "curing", "favor", "smiting", "summons", "wind walking"]) {
    if (new RegExp(`\\bbead\\s+of\\s+${bead.replace(" ", "\\s+")}\\b`, "i").test(raw)) tokens.add(`bead:${bead.replace(" ", "-")}`);
  }

  const size = raw.match(/\b(\d+)\s*(?:x|by)\s*(\d+)\s*(?:ft|feet|foot)?\.?/i);
  if (size) tokens.add(`size:${size[1]}x${size[2]}`);

  const bonus = raw.match(/(?:^|\s)\+([123])(?:\b|\s)/);
  if (bonus) tokens.add(`bonus:+${bonus[1]}`);

  return [...tokens];
}

function semanticTokensFromEffect(effect, allEffects = []) {
  if (!effect) return [];
  const tokens = new Set(semanticTokensFromText(`${effect.name ?? ""} ${effect.description ?? ""}`));
  for (const change of effectChanges(effect)) {
    const key = String(change?.key ?? "");
    const value = String(change?.value ?? "");
    if (["system.traits.dr.value", "system.traits.dv.value", "system.traits.di.value"].includes(key)) {
      for (const raw of stringSet(value)) {
        const type = normalizeDamageType(raw);
        if (type) tokens.add(`damage:${type}`);
      }
    }
    for (const token of semanticTokensFromText(value)) tokens.add(token);
  }
  const riderIds = collectionValues(effect?.flags?.dnd5e?.riders?.effect);
  for (const riderId of riderIds) {
    const rider = allEffects.find(candidate => String(candidate?._id ?? candidate?.id ?? "") === String(riderId));
    for (const token of semanticTokensFromEffect(rider, [])) tokens.add(token);
  }
  return [...tokens];
}

function extractRollTableReferences(description) {
  const refs = [];
  const regex = /(?:@Embed|@UUID)\[Compendium\.([^.\]]+\.[^.\]]+)\.RollTable\.([A-Za-z0-9]+)(?:\s+[^\]]*)?\](?:\{([^}]*)\})?/gi;
  for (const match of String(description ?? "").matchAll(regex)) {
    refs.push({
      packId: String(match[1] ?? "").trim(),
      id: String(match[2] ?? "").trim(),
      label: String(match[3] ?? "").trim(),
      uuid: `Compendium.${String(match[1] ?? "").trim()}.RollTable.${String(match[2] ?? "").trim()}`
    });
  }
  return refs;
}

function resolutionRiskFromDescription(description) {
  const text = normalizeName(stripFoundryLinks(description));
  return /\b(?:gm|dm)\s+(?:chooses|decides|determines)\b|\bdetermines?\s+it\s+randomly\b|\brandomly\s+determines?\b/.test(text);
}

function detectResolutionSpec(entry, packInfo, { setupActivity = null, profiles = [], description = "" } = {}) {
  const identifier = normalizeName(getValue(entry, "system.identifier", "")).replace(/\s+/g, "-");
  const name = normalizeName(entry.name);
  const tables = extractRollTableReferences(description);
  const tableUuid = tables[0]?.uuid ?? null;
  const materializingProfiles = profiles.filter(profile => profile.materializesBase !== false);

  if (setupActivity) {
    if (materializingProfiles.length > 1) {
      return { kind: tableUuid ? "profile-table" : "profile-choice", tableUuid };
    }
    return { kind: "template", tableUuid: null };
  }

  if (identifier === "potion-of-resistance") return { kind: "effect-table", tableUuid };
  if (identifier === "carpet-of-flying" && packInfo.id === "dnd5e.equipment24") return { kind: "activity-table", tableUuid, selector: "size" };
  if (identifier === "manual-of-golems") return { kind: packInfo.id === "dnd5e.equipment24" ? "activity-table" : "legacy-manual", tableUuid, selector: "golem" };
  if (identifier === "ring-of-elemental-command" && name === "ring of elemental command") {
    const choices = extractUuidReferences(description)
      .filter(ref => /ring/i.test(ref.label) && /dnd5e\.equipment24\.Item\./i.test(ref.uuid))
      .map(ref => ({ uuid: ref.uuid, label: ref.label }));
    return { kind: "replacement-choice", choices };
  }
  if (identifier === "necklace-of-prayer-beads") return { kind: "prayer-beads", tableUuid };
  if (identifier === "robe-of-useful-items") return { kind: "robe-patches", tableUuid };

  // Treasure-state initialization. These are complete magic items whose
  // starting quantity/contents are determined when found. Resolve the simple
  // deterministic cases here so the actor never receives the maximum-value
  // compendium placeholder as though it were the rolled treasure result.
  if (identifier === "bag-of-beans") return { kind: "initial-quantity", mode: "bag-beans", unit: "beans", removeActivity: "Count Beans" };
  if (identifier === "deck-of-illusions") return { kind: "initial-quantity", mode: "deck-illusions", unit: "cards", removeActivity: "Count Number of Cards" };
  if (identifier === "sovereign-glue") return { kind: "initial-quantity", mode: "d6-plus-1", unit: "ounces", removeActivity: "Determine Ounces" };
  if (identifier === "universal-solvent" && packInfo.id === "dnd5e.equipment24") return { kind: "initial-quantity", mode: "d6-plus-1", unit: "ounces", removeActivity: "Determine Ounces" };
  if (identifier === "deck-of-many-things" && packInfo.id === "dnd5e.items") return { kind: "initial-quantity", mode: "deck-many-things", unit: "cards" };

  if (packInfo.id === "dnd5e.items" && /(?:^|-)armor-of-resistance$/.test(identifier)) return { kind: "legacy-resistance", tableUuid };
  if (packInfo.id === "dnd5e.items" && identifier === "armor-of-vulnerability") return { kind: "legacy-vulnerability", tableUuid: null };
  if (packInfo.id === "dnd5e.items" && identifier === "dragon-scale-mail") return { kind: "legacy-dragon-scale", tableUuid: null };
  if (packInfo.id === "dnd5e.items" && identifier === "candle-of-invocation") return { kind: "legacy-candle", tableUuid };

  // A newly found Ring of Spell Storing is supposed to contain GM-selected
  // stored spell levels. There is no safe generic representation of those
  // spells in the current resolver yet, so exclude it instead of silently
  // delivering an unresolved ring.
  if (identifier === "ring-of-spell-storing") return { kind: "unsupported-initial-contents", reason: "stored-spells" };

  return null;
}

function getRawActivities(source) {
  return collectionValues(getValue(source, "system.activities", {}));
}

function getRawEffects(source) {
  return collectionValues(source?.effects ?? []);
}

function effectChanges(effect) {
  // Foundry v14 / dnd5e 6+ stores ActiveEffect changes on system.changes.
  // Accessing the legacy root-level effect.changes shim on modern documents
  // emits a deprecation warning because it exposes numeric change.mode.
  // Prefer the modern source and only fall back to legacy data when the
  // modern collection is genuinely absent/empty (Foundry 13 / dnd5e 5.x).
  const modern = collectionValues(effect?.system?.changes ?? []);
  if (modern.length) return modern;
  return collectionValues(effect?.changes ?? []);
}

function effectChangeValues(effect, keys) {
  const wanted = new Set(Array.isArray(keys) ? keys : [keys]);
  return effectChanges(effect)
    .filter(change => wanted.has(String(change?.key ?? "")))
    .flatMap(change => stringSet(change?.value));
}

function effectProfileRarity(effect) {
  return effectChangeValues(effect, ["system.rarities", "system.rarity"])
    .find(value => RARITIES.includes(value)) ?? null;
}

function effectRequiresAttunement(effect) {
  return effectChangeValues(effect, "system.attunement").some(value => value === "required" || value === "2");
}

function effectMaterializesBase(effect) {
  return effectChanges(effect).some(change => {
    const key = String(change?.key ?? "");
    const value = String(change?.value ?? "");
    const type = String(change?.type ?? "");
    if (key === "name" && (value.includes("{}") || type === "override")) return true;
    if (["system.description.value", "system.rarity", "system.rarities", "img"].includes(key)) return true;
    if (key === "system.properties" && /(?:^|[,;\s])mgc(?:$|[,;\s])/.test(value)) return true;
    return false;
  });
}

function isSetupEnchantActivityData(activity) {
  if (!activity || String(activity.type ?? "") !== "enchant") return false;
  if (Boolean(activity.enchant?.self)) return false;
  if (!collectionValues(activity.effects).length) return false;

  // Official 2024 template/setup enchantments are hidden construction activities.
  // Playable enchantments such as Oil of Sharpness and Helm of Brilliance are
  // visible magic activities and must remain on the ready-to-use item instead.
  const visibility = activity.visibility ?? {};
  if (visibility.requireMagic || visibility.requireIdentification || visibility.requireAttunement) return false;
  return true;
}

function getSetupEnchantActivityData(source) {
  return getRawActivities(source).find(isSetupEnchantActivityData) ?? null;
}

function buildEnchantmentProfiles(source, setupActivity) {
  if (!setupActivity) return [];
  const allEffects = getRawEffects(source);
  const effects = new Map(allEffects.map(effect => [String(effect?._id ?? effect?.id ?? ""), effect]));
  return collectionValues(setupActivity.effects).map(profile => {
    const id = String(profile?._id ?? profile?.id ?? "");
    if (!id) return null;
    const effect = effects.get(id);
    const riders = foundry.utils.deepClone(profile?.riders ?? { activity: [], effect: [], item: [] });
    const semantics = new Set(semanticTokensFromEffect(effect, allEffects));
    for (const riderId of collectionValues(riders.effect)) {
      const rider = effects.get(String(riderId));
      for (const token of semanticTokensFromEffect(rider, allEffects)) semantics.add(token);
    }
    return {
      id,
      name: String(effect?.name ?? profile?.name ?? ""),
      rarity: effectProfileRarity(effect),
      requiresAttunement: effectRequiresAttunement(effect),
      materializesBase: effectMaterializesBase(effect),
      riders,
      primarySemantics: semanticTokensFromText(effect?.name ?? profile?.name ?? ""),
      semantics: [...semantics]
    };
  }).filter(Boolean);
}

function extractUuidReferences(description) {
  const refs = [];
  const regex = /@UUID\[([^\]]+)\](?:\{([^}]*)\})?/gi;
  for (const match of String(description ?? "").matchAll(regex)) {
    const uuid = String(match[1] ?? "").trim();
    if (!uuid || !uuid.includes(".Item.")) continue;
    refs.push({ uuid, label: String(match[2] ?? "").trim() });
  }
  return refs;
}

function categorize(entry, { setupActivity = null } = {}) {
  const documentType = String(entry.type ?? "");
  const subtype = String(getValue(entry, "system.type.value", ""));
  const baseItem = String(getValue(entry, "system.type.baseItem", ""));
  if (documentType === "weapon") {
    if (baseItem === "quarterstaff" || subtype === "staff") return "staff";
    return "weapon";
  }

  if (subtype === "shield") return "shield";
  if (["light", "medium", "heavy", "natural"].includes(subtype)) return "armor";
  if (subtype === "wand") return "wand";
  if (subtype === "rod") return "rod";
  if (subtype === "ring") return "ring";
  if (subtype === "potion") return "potion";
  if (subtype === "scroll") return "scroll";
  if (subtype === "ammo") return "ammunition";

  if (setupActivity) {
    const name = normalizeName(entry.name);
    const text = normalizeName(plainTextFromHtml(getValue(entry, "system.description.value", "")).slice(0, 650));
    if (documentType === "consumable" && /ammunition/.test(`${name} ${text}`)) return "ammunition";
    if (/^armor\b|\barmor\s*\(/.test(`${name} ${text}`)) return "armor";
    if (/^shield\b|\{shield\}/.test(`${name} ${text}`)) return "shield";
    if (/^wand\b|\{wand\}/.test(`${name} ${text}`)) return "wand";
    if (/^ring\b|\{ring\}/.test(`${name} ${text}`)) return "ring";
    if (/^weapon\b|\bweapon\s*\(/.test(`${name} ${text}`)) return "weapon";
  }

  return "wondrous";
}

function extractClassRestrictions(description) {
  const text = normalizeName(plainTextFromHtml(description));
  const classes = SPELL_CLASSES.concat(["artificer", "barbarian", "fighter", "monk", "rogue"]);
  const restrictions = new Set();
  const clauses = text.match(/(?:requires attunement|attunement|attuned)[^.\n]{0,180}/g) ?? [];
  for (const clause of clauses) {
    for (const cls of classes) {
      if (new RegExp(`\\b${cls}\\b`, "i").test(clause)) restrictions.add(cls);
    }
  }
  return [...restrictions];
}

function requiresSpellcaster(description) {
  const text = normalizeName(plainTextFromHtml(description));
  return /(?:requires attunement|attunement|attuned)[^.\n]{0,140}\bspellcaster\b/.test(text);
}

function flattenEffectChanges(effects = []) {
  const changes = [];
  for (const effect of effects ?? []) {
    for (const change of effectChanges(effect)) {
      changes.push({
        key: String(change?.key ?? ""),
        value: String(change?.value ?? ""),
        type: String(change?.type ?? "")
      });
    }
  }
  return changes;
}

function normalizeIndexEntry(entry, packInfo) {
  const resolutionIdentifier = normalizeName(getValue(entry, "system.identifier", "")).replace(/\s+/g, "-");
  // The four elemental-command ring documents are implementation targets for
  // the generic Ring of Elemental Command. Keeping both the parent and these
  // support documents in the draw pool would double-count the same magic item
  // and could allow duplicate concrete results in one session.
  if (packInfo.id === "dnd5e.equipment24" && resolutionIdentifier === "ring-of-elemental-command" && normalizeName(entry.name) !== "ring of elemental command") {
    return null;
  }
  const directRarities = getItemRarities(entry);
  const setupActivity = getSetupEnchantActivityData(entry);
  const profiles = buildEnchantmentProfiles(entry, setupActivity);
  const profileRarities = profiles.map(profile => profile.rarity).filter(Boolean);
  const rarities = [...new Set([...directRarities, ...profileRarities])].filter(rarity => RARITIES.includes(rarity));
  if (!rarities.length) return null;

  const documentType = String(entry.type ?? "");
  const subtype = String(getValue(entry, "system.type.value", ""));
  const autoDestroy = Boolean(getValue(entry, "system.uses.autoDestroy", false));
  const consumable = documentType === "consumable" || autoDestroy;
  const attunement = String(getValue(entry, "system.attunement", ""));
  const category = categorize(entry, { setupActivity });
  const id = entry._id ?? entry.id;
  if (!id) return null;
  const description = String(getValue(entry, "system.description.value", ""));
  const rarity = directRarities[0] ?? profileRarities[0] ?? rarities[0];
  const resolutionSpec = detectResolutionSpec(entry, packInfo, { setupActivity, profiles, description });
  const resolutionRisk = resolutionRiskFromDescription(description);

  return {
    id,
    uuid: `Compendium.${packInfo.id}.Item.${id}`,
    packId: packInfo.id,
    packLabel: i18n(packInfo.labelKey),
    sourcePriority: packInfo.priority,
    name: String(entry.name ?? i18n("EMI.Common.UnnamedItem")),
    normalizedName: normalizeName(entry.name),
    img: String(entry.img ?? "icons/svg/item-bag.svg"),
    rarity,
    rarities,
    directRarities,
    rarityLabel: rarityLabel(rarity),
    category,
    categoryLabel: categoryLabel(category),
    consumable,
    requiresAttunement: attunement === "required" || profiles.some(profile => profile.requiresAttunement),
    attunement,
    documentType,
    subtype,
    baseItem: String(getValue(entry, "system.type.baseItem", "")),
    properties: getProperties(entry),
    rules: String(getValue(entry, "system.source.rules", "")),
    identifier: String(getValue(entry, "system.identifier", "")),
    description,
    materializationMode: setupActivity ? "template" : "ready",
    setupActivityId: String(setupActivity?._id ?? setupActivity?.id ?? ""),
    profiles,
    resolutionSpec,
    resolutionRequired: Boolean(setupActivity || resolutionSpec),
    resolutionRisk,
    resolutionUnsupported: resolutionSpec?.kind === "unsupported-initial-contents",
    explicitBaseUuids: extractUuidReferences(description.slice(0, 1000)).map(ref => ref.uuid),
    enchantmentTemplate: Boolean(setupActivity),
    classRestrictions: extractClassRestrictions(description),
    spellcasterRestricted: requiresSpellcaster(description),
    effectChanges: flattenEffectChanges(getRawEffects(entry))
  };
}

function normalizeBaseItemEntry(entry, packInfo) {
  if (getItemRarities(entry).length) return null;
  if (getSetupEnchantActivityData(entry)) return null;
  if (!["weapon", "equipment", "consumable"].includes(String(entry.type ?? ""))) return null;
  const id = entry._id ?? entry.id;
  if (!id) return null;
  return {
    id,
    uuid: `Compendium.${packInfo.id}.Item.${id}`,
    packId: packInfo.id,
    sourcePriority: packInfo.priority,
    name: String(entry.name ?? i18n("EMI.Common.UnnamedItem")),
    normalizedName: normalizeName(entry.name),
    img: String(entry.img ?? "icons/svg/item-bag.svg"),
    documentType: String(entry.type ?? ""),
    subtype: String(getValue(entry, "system.type.value", "")),
    baseItem: String(getValue(entry, "system.type.baseItem", "")),
    properties: getProperties(entry),
    description: String(getValue(entry, "system.description.value", ""))
  };
}

async function collectRegistrySpells() {
  const spellLists = globalThis.dnd5e?.registry?.spellLists;
  if (!spellLists?.forType) return [];
  try {
    if (globalThis.dnd5e?.registry?.ready) await globalThis.dnd5e.registry.ready;
  } catch (error) {
    console.warn(`${MODULE_ID} | D&D5e registries did not finish cleanly; falling back to compendium spell discovery.`, error);
  }

  const byUuid = new Map();
  for (const cls of SPELL_CLASSES) {
    const list = spellLists.forType(`class:${cls}`) ?? spellLists.forType("class", cls);
    if (!list) continue;
    const uuids = collectionValues(list.uuids);
    for (const uuid of uuids) {
      const key = String(uuid ?? "");
      if (!key) continue;
      const existing = byUuid.get(key) ?? { uuid: key, classes: new Set() };
      existing.classes.add(cls);
      byUuid.set(key, existing);
    }
  }

  const spells = [];
  for (const row of byUuid.values()) {
    let spell = null;
    try { spell = globalThis.fromUuidSync?.(row.uuid) ?? null; } catch (_error) { /* load asynchronously below */ }
    const needsDocument = !spell || getValue(spell, "system.level", undefined) === undefined || !spell.name;
    if (needsDocument) {
      try { spell = await fromUuid(row.uuid); } catch (_error) { spell = null; }
    }
    if (!spell || String(spell.type ?? "") !== "spell") continue;
    spells.push({
      id: spell._id ?? spell.id,
      uuid: row.uuid,
      name: String(spell.name ?? i18n("EMI.Common.Spell")),
      normalizedName: normalizeName(spell.name),
      level: Number(getValue(spell, "system.level", 0)),
      school: String(getValue(spell, "system.school", "")),
      classes: [...row.classes],
      img: String(spell.img ?? "icons/svg/book.svg"),
      rules: String(getValue(spell, "system.source.rules", "")),
      sourcePriority: String(row.uuid).startsWith("Compendium.dnd-players-handbook.") ? 3
        : String(getValue(spell, "system.source.rules", "")) === "2024" ? 2 : 1
    });
  }
  return spells;
}

async function collectLegacySpells(fields) {
  const spells = [];
  for (const pack of game.packs) {
    if (pack.documentName !== "Item" || !String(pack.collection).startsWith("dnd5e.")) continue;
    let index;
    try { index = await pack.getIndex({ fields }); } catch (_error) { continue; }
    for (const entry of index) {
      if (entry.type !== "spell") continue;
      const rawClasses = getValue(entry, "system.sourceClass", getValue(entry, "system.classes", getValue(entry, "system.source.classes", [])));
      const classes = Array.isArray(rawClasses) ? rawClasses
        : rawClasses && typeof rawClasses === "object" ? Object.keys(rawClasses).filter(key => rawClasses[key])
          : String(rawClasses ?? "").split(/[;,|]/);
      spells.push({
        id: entry._id ?? entry.id,
        uuid: `Compendium.${pack.collection}.Item.${entry._id ?? entry.id}`,
        name: String(entry.name ?? i18n("EMI.Common.Spell")),
        normalizedName: normalizeName(entry.name),
        level: Number(getValue(entry, "system.level", 0)),
        school: String(getValue(entry, "system.school", "")),
        classes: classes.map(value => normalizeName(value)).filter(Boolean),
        img: String(entry.img ?? "icons/svg/book.svg"),
        rules: String(getValue(entry, "system.source.rules", "")),
        sourcePriority: pack.collection === "dnd5e.spells24" ? 2 : 1
      });
    }
  }
  return spells;
}

async function buildCatalog({ force = false } = {}) {
  if (catalogCache && !force) return catalogCache;
  if (catalogBuildPromise && !force) return catalogBuildPromise;

  const build = async () => {
    // These two catalog packs are first-party D&D5e packs with a known schema.
    // Foundry compendium indexes reliably materialize requested leaf fields,
    // while requesting object parents (e.g. `system.type`) can yield an
    // incomplete index in v14 and make every entry look non-magical. Keep the
    // catalog index explicit and leaf-based here; the broad/third-party spell
    // discovery path below remains deliberately minimal and defensive.
    const fields = [
      "name", "img", "type", "system.rarity", "system.rarities", "system.attunement",
      "system.type.value", "system.type.baseItem", "system.properties", "system.identifier",
      "system.uses.autoDestroy", "system.level", "system.school",
      "system.description.value", "system.activities", "effects"
    ];

    const all = [];
    const baseItems = [];
    const availablePacks = [];

    for (const packInfo of PACKS) {
      const pack = game.packs.get(packInfo.id);
      if (!pack) continue;
      availablePacks.push(packInfo.id);
      let index;
      try {
        index = await pack.getIndex({ fields });
      } catch (error) {
        console.warn(`${MODULE_ID} | Could not index compendium: ${packInfo.id}`, error);
        continue;
      }
      for (const entry of index) {
        // Compendium indexes do not reliably include the nested ActiveEffect
        // change data referenced by EnchantActivity profiles. That metadata is
        // required to distinguish true materialization profiles from
        // supplemental profiles (for example Hammer of Thunderbolts) and to
        // recover profile-specific rarity/riders. Hydrate only entries that
        // expose an enchant activity in the index; this is a small subset of
        // the official equipment pack and keeps the general catalog fast.
        const hasEnchantActivity = getRawActivities(entry).some(activity => String(activity?.type ?? "") === "enchant");
        let catalogSource = entry;
        if (hasEnchantActivity) {
          const id = entry._id ?? entry.id;
          if (id) {
            try {
              const document = await pack.getDocument(id);
              if (document) catalogSource = document.toObject();
            } catch (error) {
              console.warn(`${MODULE_ID} | Could not hydrate enchantment template: ${packInfo.id}.${id}`, error);
            }
          }
        }

        const normalized = normalizeIndexEntry(catalogSource, packInfo);
        if (normalized) all.push(normalized);
        const base = normalizeBaseItemEntry(catalogSource, packInfo);
        if (base) baseItems.push(base);
      }
    }

    const dedupeByName = (entries, prefer = "sourcePriority") => {
      const map = new Map();
      for (const entry of entries) {
        const key = entry.normalizedName || entry.uuid;
        const current = map.get(key);
        if (!current || Number(entry[prefer] ?? 0) > Number(current[prefer] ?? 0)) map.set(key, entry);
      }
      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    };

    let spells = await collectRegistrySpells();
    if (!spells.length) {
      const spellFields = [
        "name", "img", "type", "system.level", "system.school",
        "system.sourceClass", "system.classes"
      ];
      spells = await collectLegacySpells(spellFields);
    }

    const uniqueAcrossAllSources = new Map();
    for (const item of all) {
      const current = uniqueAcrossAllSources.get(item.normalizedName);
      if (!current || item.sourcePriority > current.sourcePriority) uniqueAcrossAllSources.set(item.normalizedName, item);
    }

    if (!availablePacks.length) throw new Error(i18n("EMI.Error.NoCompatiblePacks"));
    if (!all.length) throw new Error(i18n("EMI.Error.EmptyCatalog"));

    const uniqueBaseItems = dedupeByName(baseItems);
    catalogCache = {
      builtAt: Date.now(),
      availablePacks,
      items: all.sort((a, b) => a.name.localeCompare(b.name)),
      baseItems: uniqueBaseItems,
      baseWeapons: uniqueBaseItems.filter(item => item.documentType === "weapon" && item.baseItem),
      spells: dedupeByName(spells),
      uniqueCount: uniqueAcrossAllSources.size
    };

    return catalogCache;
  };

  catalogBuildPromise = build();
  try {
    return await catalogBuildPromise;
  } finally {
    catalogBuildPromise = null;
  }
}

function invalidateCatalog() {
  catalogCache = null;
}


function abilityValue(actor, ability) {
  return Number(actor?.system?.abilities?.[ability]?.value ?? 10);
}

function actorRecommendationProfile(actor) {
  const base = actorClassProfile(actor);
  const str = abilityValue(actor, "str");
  const dex = abilityValue(actor, "dex");
  const int = abilityValue(actor, "int");
  const wis = abilityValue(actor, "wis");
  const cha = abilityValue(actor, "cha");
  const hasMartialWeapons = base.weaponProf.some(value => ["mar", "martial", "martial weapons"].includes(value));
  const hasSimpleWeapons = base.weaponProf.some(value => ["sim", "simple", "simple weapons"].includes(value));
  const offensiveStyle = dex >= str + 2 ? "dex" : str >= dex + 2 ? "str" : "either";
  const casterAbility = String(actor?.system?.attributes?.spellcasting ?? "");
  const casterScore = casterAbility ? abilityValue(actor, casterAbility) : Math.max(int, wis, cha);
  const pureArcaneCaster = base.arcane && !hasMartialWeapons && casterScore >= Math.max(str, dex) + 2;
  const featureKeys = [...(actor?.items ?? [])]
    .filter(item => !["class", "weapon", "equipment", "spell"].includes(item.type))
    .map(item => normalizeName(`${item.system?.identifier ?? ""} ${item.name ?? ""}`));
  const hasBladePact = featureKeys.some(value => /\bpact\b.*\bblade\b|\bblade\b.*\bpact\b/.test(value));
  const pureWizardOrSorcerer = base.classes.length > 0 && base.classes.every(cls => ["wizard", "sorcerer"].includes(cls));
  return {
    ...base, str, dex, int, wis, cha, casterAbility, casterScore,
    hasMartialWeapons, hasSimpleWeapons, offensiveStyle, pureArcaneCaster,
    hasBladePact, pureWizardOrSorcerer
  };
}

function rarityForLevel(level) {
  const ranges = {
    common: [1, 2],
    uncommon: [2, 9],
    rare: [5, 16],
    veryRare: [10, 20],
    legendary: [13, 20],
    artifact: [15, 20]
  };
  return Object.entries(ranges)
    .filter(([, [minimum, maximum]]) => level >= minimum && level <= maximum)
    .map(([rarity]) => rarity);
}

function baseWeaponAbilityMode(weapon) {
  const properties = new Set((weapon?.properties ?? []).map(normalizeName));
  const subtype = normalizeName(weapon?.subtype);
  const finesse = properties.has("fin") || properties.has("finesse");
  const thrown = properties.has("thr") || properties.has("thrown");
  const ranged = subtype.endsWith("r") || subtype.includes("ranged");
  if (finesse) return "either";
  if (ranged && !thrown) return "dex";
  return "str";
}

function weaponMatchesAbilityProfile(weapon, profile) {
  if (!profile || profile.offensiveStyle === "either") return true;
  const mode = baseWeaponAbilityMode(weapon);
  return mode === "either" || mode === profile.offensiveStyle;
}

function itemModifiesAbility(item, ability) {
  const needle = `abilities.${ability}`;
  if ((item.effectChanges ?? []).some(change => normalizeName(change.key).includes(needle))) return true;
  const text = normalizeName(plainTextFromHtml(item.description ?? ""));
  const label = ability === "str" ? "strength" : ability === "dex" ? "dexterity" : ability;
  return new RegExp(`\\b${label}\\b[^.]{0,90}(?:score|becomes|changes|increase|sets|equal)`, "i").test(text);
}

function recommendationEvaluation(item, filters, profile = null) {
  const reasons = [];
  const warnings = [];
  let score = 50;

  if (filters.characterClasses?.length && item.classRestrictions?.length) {
    if (!item.classRestrictions.some(cls => filters.characterClasses.includes(cls))) {
      return { eligible: false, score: 0, reasons, warnings: [i18nFormat("EMI.Recommendation.RequiresClasses", { classes: item.classRestrictions.map(classLabel).join(i18n("EMI.Common.Or")) })] };
    }
    score += 18;
    reasons.push(i18n("EMI.Recommendation.MatchesClassRestriction"));
  }
  if (item.spellcasterRestricted && !profile?.spellcasting) {
    return { eligible: false, score: 0, reasons, warnings: [i18n("EMI.Recommendation.RequiresSpellcaster")] };
  }

  if (item.category === "rod" && profile?.arcane) {
    score += 18;
    reasons.push(i18n("EMI.Recommendation.ArcaneRod"));
  }
  if (["staff", "wand", "scroll"].includes(item.category) && profile?.spellcasting) {
    score += 14;
    reasons.push(i18n("EMI.Recommendation.SupportsSpellcasting"));
  }

  if (item.category === "weapon" && profile) {
    const compatible = compatibleBaseWeapons(item, catalogCache?.baseWeapons ?? [], { fallback: false })
      .filter(weapon => !filters.allowedWeaponBases?.length || filters.allowedWeaponBases.includes(weapon.uuid));
    if (!compatible.length) return { eligible: false, score: 0, reasons, warnings: [i18n("EMI.Recommendation.NoCompatibleWeapon")] };
    if (!compatible.some(weapon => weaponMatchesAbilityProfile(weapon, profile))) {
      return { eligible: false, score: 0, reasons, warnings: [i18nFormat("EMI.Recommendation.WeaponStyleMismatch", { ability: profile.offensiveStyle.toUpperCase() })] };
    }
    score += 12;
    reasons.push(i18nFormat("EMI.Recommendation.CompatibleWeapon", { ability: profile.offensiveStyle.toUpperCase() }));
  }

  if (itemModifiesAbility(item, "str") && profile) {
    if (profile.pureArcaneCaster && profile.offensiveStyle !== "str") {
      return { eligible: false, score: 0, reasons, warnings: [i18n("EMI.Recommendation.StrengthArcaneWarning")] };
    }
    if (profile.offensiveStyle === "dex") {
      score -= 35;
      warnings.push(i18n("EMI.Recommendation.StrengthForDexWarning"));
    } else {
      score += 10;
      reasons.push(i18n("EMI.Recommendation.StrengthBuild"));
    }
  }

  if (itemModifiesAbility(item, "dex") && profile) {
    if (profile.offensiveStyle === "str") {
      score -= 20;
      warnings.push(i18n("EMI.Recommendation.DexForStrengthWarning"));
    } else {
      score += 10;
      reasons.push(i18n("EMI.Recommendation.DexBuild"));
    }
  }

  if (["ring", "wondrous", "potion"].includes(item.category)) score += 4;
  return { eligible: score >= 30, score: Math.max(0, Math.min(100, score)), reasons, warnings };
}

function filterCatalog(items, filters) {
  const sources = new Set(filters.sources ?? []);
  const rarities = new Set(filters.rarities ?? []);
  const categories = new Set(filters.categories ?? []);
  const permanence = new Set(filters.permanence ?? []);
  const attunement = String(filters.attunement ?? "any");

  const matching = items.filter(item => {
    // Safety invariant: an item that looks acquisition-time configurable but has
    // no resolver must never be granted as a raw template. It stays out of pools
    // until a resolver is implemented.
    if (item.resolutionUnsupported) return false;
    if (sources.size && !sources.has(item.packId)) return false;
    if (rarities.size && !itemMatchesRarityFilter(item, [...rarities])) return false;
    if (categories.size && !categories.has(item.category)) return false;
    if (permanence.size) {
      const key = item.consumable ? "consumable" : "permanent";
      if (!permanence.has(key)) return false;
    }
    if (attunement === "required" && !item.requiresAttunement) return false;
    if (attunement === "none" && item.requiresAttunement) return false;
    if (filters.characterClasses?.length && item.classRestrictions?.length && !item.classRestrictions.some(cls => filters.characterClasses.includes(cls))) return false;
    if (item.category === "armor" && filters.allowedArmorTypes?.length) {
      if (item.materializationMode === "template") {
        const compatible = compatibleBaseItems(item, catalogCache?.baseItems ?? [], { fallback: false });
        if (!compatible.some(base => filters.allowedArmorTypes.includes(base.subtype))) return false;
      } else if (item.subtype && !filters.allowedArmorTypes.includes(item.subtype)) return false;
    }
    if (item.category === "shield" && filters.allowedArmorTypes?.length && !filters.allowedArmorTypes.includes("shield")) return false;
    if (!itemAllowsSelectedWeapon(item, filters.weaponBase)) return false;
    if (item.category === "weapon" && filters.weaponBase === "random" && filters.allowedWeaponBases?.length) {
      const compatible = compatibleBaseWeapons(item, catalogCache?.baseWeapons ?? [], { fallback: false });
      if (!compatible.some(weapon => filters.allowedWeaponBases.includes(weapon.uuid))) return false;
    }
    if (filters.smartPreset) {
      const evaluation = recommendationEvaluation(item, filters, filters.recommendationProfile);
      if (!evaluation.eligible) return false;
    }
    return true;
  });

  // Deduplicate only after source selection. This preserves SRD versions when
  // the 2024 pack is disabled, while still preferring 2024 when both are used.
  const deduped = new Map();
  for (const item of matching) {
    const current = deduped.get(item.normalizedName);
    if (!current || item.sourcePriority > current.sourcePriority) {
      deduped.set(item.normalizedName, item);
    }
  }
  return [...deduped.values()];
}

function randomChoice(array) {
  if (!array.length) return null;
  return array[Math.floor(Math.random() * array.length)];
}

function weightedChoice(array, weightFor) {
  if (!array.length) return null;
  const weighted = array.map(entry => ({ entry, weight: Math.max(0, Number(weightFor(entry)) || 0) }));
  const total = weighted.reduce((sum, row) => sum + row.weight, 0);
  if (total <= 0) return randomChoice(array);
  let roll = Math.random() * total;
  for (const row of weighted) {
    roll -= row.weight;
    if (roll <= 0) return row.entry;
  }
  return weighted.at(-1)?.entry ?? null;
}

function unavailableUuids(session) {
  return new Set([...(session.usedUuids ?? []), ...Object.values(session.reserved ?? {}).map(item => item.uuid)]);
}

function sessionPool(session, tokenUuid) {
  const unavailable = unavailableUuids(session);
  return (session.participantPools?.[tokenUuid] ?? []).filter(item => !unavailable.has(item.uuid));
}

function hasDistinctAssignment(tokenUuids, participantPools, blocked = new Set()) {
  const ordered = [...tokenUuids].sort((a, b) => {
    const aCount = (participantPools[a] ?? []).filter(item => !blocked.has(item.uuid)).length;
    const bCount = (participantPools[b] ?? []).filter(item => !blocked.has(item.uuid)).length;
    return aCount - bCount;
  });
  const assigned = new Set();

  function visit(index) {
    if (index >= ordered.length) return true;
    const tokenUuid = ordered[index];
    for (const item of participantPools[tokenUuid] ?? []) {
      if (blocked.has(item.uuid) || assigned.has(item.uuid)) continue;
      assigned.add(item.uuid);
      if (visit(index + 1)) return true;
      assigned.delete(item.uuid);
    }
    return false;
  }

  return visit(0);
}

function viableCandidates(session, tokenUuid) {
  const unavailable = unavailableUuids(session);
  const remainingTokens = session.participants
    .map(participant => participant.tokenUuid)
    .filter(uuid => uuid !== tokenUuid && !session.results?.[uuid]);

  return sessionPool(session, tokenUuid).filter(candidate => {
    const blocked = new Set(unavailable);
    blocked.add(candidate.uuid);
    return hasDistinctAssignment(remainingTokens, session.participantPools, blocked);
  });
}

function profileEffectiveRarity(item, profile) {
  if (profile?.rarity && RARITIES.includes(profile.rarity)) return profile.rarity;
  const direct = item?.directRarities ?? [];
  if (direct.length === 1) return direct[0];
  if (item?.rarity && RARITIES.includes(item.rarity)) return item.rarity;
  return null;
}

function selectableProfiles(item, allowedRarities = []) {
  let profiles = [...(item?.profiles ?? [])];
  if (!profiles.length) return [];
  const direct = item?.directRarities ?? [];

  // A setup activity may also carry optional follow-up enchantments. Prefer
  // profiles whose changes actually transform a mundane base (name/description/
  // magic property/rarity/image). This excludes supplemental states such as
  // Hammer of Thunderbolts' paired-attunement bonus without hard-coding names.
  const materializing = profiles.filter(profile => profile.materializesBase !== false);
  if (materializing.length) profiles = materializing;

  const allowed = new Set(allowedRarities ?? []);
  if (allowed.size) {
    profiles = profiles.filter(profile => {
      const rarity = profileEffectiveRarity(item, profile);
      return rarity ? allowed.has(rarity) : direct.some(value => allowed.has(value));
    });
  }
  return profiles;
}

function displayRarityLabel(item, filters = {}) {
  if (item?.materializationMode === "template" && item?.profiles?.length) {
    const rarities = [...new Set(selectableProfiles(item, filters?.rarities ?? [])
      .map(profile => profileEffectiveRarity(item, profile))
      .filter(Boolean))];
    if (rarities.length === 1) return rarityLabel(rarities[0]);
    if (rarities.length > 1) return rarities.map(rarityLabel).join(" / ");
  }
  return rarityLabel(item?.rarity);
}

function itemMatchesRarityFilter(item, rarities) {
  const allowed = new Set(rarities ?? []);
  if (!allowed.size) return true;
  if (item?.materializationMode === "template" && item?.profiles?.length) {
    return selectableProfiles(item, [...allowed]).length > 0;
  }
  return (item?.rarities ?? [item?.rarity]).some(rarity => allowed.has(rarity));
}

async function rollResolutionTable(tableUuid) {
  if (!tableUuid) return null;
  let table = null;
  try { table = await fromUuid(tableUuid); } catch (_error) { table = null; }
  if (!table || table.documentName !== "RollTable" || typeof table.roll !== "function") return null;
  try {
    const rolled = await table.roll({ recursive: false });
    const results = collectionValues(rolled?.results ?? rolled?.result ?? []);
    const result = results[0] ?? null;
    const description = String(result?.description ?? result?.text ?? result?.name ?? "");
    const allResults = collectionValues(table.results).map(row => ({
      resultId: String(row?._id ?? row?.id ?? ""),
      description: String(row?.description ?? row?.text ?? row?.name ?? ""),
      range: foundry.utils.deepClone(row?.range ?? null)
    }));
    return {
      tableUuid,
      rollTotal: Number(rolled?.roll?.total ?? rolled?.total ?? NaN),
      resultId: String(result?._id ?? result?.id ?? ""),
      description,
      range: foundry.utils.deepClone(result?.range ?? null),
      allResults
    };
  } catch (error) {
    console.warn(`${MODULE_ID} | Resolution table roll failed: ${tableUuid}`, error);
    return null;
  }
}

function referencedActiveEffectId(text) {
  const match = String(text ?? "").match(/\.ActiveEffect\.([A-Za-z0-9]+)/i);
  return match?.[1] ?? null;
}

function referencedItemUuids(text) {
  const refs = [];
  for (const match of String(text ?? "").matchAll(/@UUID\[([^\]]*\.Item\.[^\]]+)\](?:\{([^}]*)\})?/gi)) {
    refs.push({ uuid: String(match[1] ?? ""), label: String(match[2] ?? "") });
  }
  return refs;
}

function outcomeSemanticTokens(outcome, profiles = []) {
  if (!outcome) return [];
  const description = String(outcome.description ?? "");
  const explicitLabels = [...description.matchAll(/@UUID\[[^\]]+\]\{([^}]*)\}/gi)].map(match => match[1]).filter(Boolean);
  let tokens = semanticTokensFromText(explicitLabels.length ? explicitLabels.join(" ") : stripFoundryLinks(description));
  if (tokens.length) return tokens;

  const refId = referencedActiveEffectId(description);
  const profile = profiles.find(candidate => candidate.id === refId);
  if (profile) return [...(profile.primarySemantics?.length ? profile.primarySemantics : profile.semantics ?? [])];
  return [];
}

function profileMatchesTokens(profile, tokens) {
  if (!tokens?.length) return false;
  const primary = new Set(profile?.primarySemantics ?? []);
  const all = new Set(profile?.semantics ?? []);
  return tokens.some(token => primary.has(token)) || tokens.some(token => all.has(token));
}

function explicitOutcomeTokens(description) {
  const labels = [...String(description ?? "").matchAll(/@UUID\[[^\]]+\]\{([^}]*)\}/gi)].map(match => match[1]).filter(Boolean);
  const raw = labels.length ? labels.join(" ") : stripFoundryLinks(description);
  return semanticTokensFromText(raw);
}

function uniqueProfileForTokens(profiles, tokens) {
  if (!tokens?.length) return null;
  const matches = profiles.filter(profile => profileMatchesTokens(profile, tokens));
  return matches.length === 1 ? matches[0] : null;
}

function sanitizedTableProfileMap(allResults, profiles) {
  const rows = (allResults ?? []).map(row => {
    const labelTokens = explicitOutcomeTokens(row.description);
    const labelProfile = uniqueProfileForTokens(profiles, labelTokens);
    const refId = referencedActiveEffectId(row.description);
    const refProfile = profiles.find(profile => profile.id === refId) ?? null;
    return { ...row, labelTokens, labelProfile, refProfile, chosen: labelProfile ?? refProfile ?? null };
  });

  if (rows.length !== profiles.length) {
    return new Map(rows.filter(row => row.chosen).map(row => [row.resultId, row.chosen]));
  }

  const countChosen = () => {
    const counts = new Map();
    for (const row of rows) if (row.chosen) counts.set(row.chosen.id, (counts.get(row.chosen.id) ?? 0) + 1);
    return counts;
  };

  let counts = countChosen();
  let missing = new Set(profiles.filter(profile => !counts.has(profile.id)).map(profile => profile.id));
  for (const row of rows) {
    if (!row.chosen || (counts.get(row.chosen.id) ?? 0) <= 1) continue;
    if (row.refProfile && missing.has(row.refProfile.id)) {
      counts.set(row.chosen.id, counts.get(row.chosen.id) - 1);
      row.chosen = row.refProfile;
      counts.set(row.chosen.id, 1);
      missing.delete(row.chosen.id);
    }
  }

  counts = countChosen();
  missing = new Set(profiles.filter(profile => !counts.has(profile.id)).map(profile => profile.id));
  for (const row of rows) {
    if (!row.chosen || (counts.get(row.chosen.id) ?? 0) <= 1) continue;
    if (row.labelProfile && missing.has(row.labelProfile.id)) {
      counts.set(row.chosen.id, counts.get(row.chosen.id) - 1);
      row.chosen = row.labelProfile;
      counts.set(row.chosen.id, 1);
      missing.delete(row.chosen.id);
    }
  }

  return new Map(rows.filter(row => row.chosen).map(row => [row.resultId, row.chosen]));
}

async function selectProfileFromOfficialTable(item, profiles, tableUuid) {
  const outcome = await rollResolutionTable(tableUuid);
  if (!outcome) return { profile: randomChoice(profiles), outcome: null };

  const wanted = outcomeSemanticTokens(outcome, profiles);
  const referencedId = referencedActiveEffectId(outcome.description);
  const referenced = profiles.find(profile => profile.id === referencedId) ?? null;
  const tableMap = sanitizedTableProfileMap(outcome.allResults ?? [], profiles);
  const mapped = tableMap.get(outcome.resultId) ?? null;
  const semanticMatches = profiles.filter(profile => profileMatchesTokens(profile, wanted));
  const profile = mapped ?? semanticMatches[0] ?? referenced ?? randomChoice(profiles);

  if (profile && ((referenced && referenced.id !== profile.id) || (wanted.length && !profileMatchesTokens(profile, wanted)))) {
    console.warn(`${MODULE_ID} | Official table/profile mismatch sanitized`, {
      item: item.name,
      tableUuid,
      tableResult: outcome.description,
      referencedProfile: referenced?.name ?? null,
      selectedProfile: profile.name,
      wanted
    });
  }
  return { profile, outcome };
}

function previewResolvedReadyName(item, resolution) {
  const base = String(item?.name ?? i18n("EMI.Common.UnnamedItem"));
  if (!resolution) return base;
  if (resolution.previewName) return resolution.previewName;
  if (resolution.damageType && /armor of resistance$/i.test(base)) {
    return base.replace(/armor of resistance$/i, `Armor of ${titleCase(resolution.damageType)} Resistance`);
  }
  if (resolution.damageType && normalizeName(base) === "potion of resistance") {
    return `Potion of ${titleCase(resolution.damageType)} Resistance`;
  }
  return base;
}

function randomDie(sides) {
  return Math.floor(Math.random() * Math.max(1, Number(sides) || 1)) + 1;
}

function roll4d4() {
  return randomDie(4) + randomDie(4) + randomDie(4) + randomDie(4);
}

function choiceToken(tokens, prefix) {
  return tokens.find(token => token.startsWith(`${prefix}:`))?.slice(prefix.length + 1) ?? null;
}

function activitySemanticTokens(activity) {
  const spellUuid = String(activity?.spell?.uuid ?? "");
  return semanticTokensFromText(`${activity?.name ?? ""} ${spellUuid}`);
}

function tableOutcomeLabel(outcome) {
  if (!outcome) return "";
  const html = stripFoundryLinks(outcome.description)
    .replace(/<br\s*\/?>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return html;
}

function compactTableOutcome(outcome) {
  if (!outcome) return null;
  return {
    tableUuid: outcome.tableUuid ?? null,
    rollTotal: Number.isFinite(Number(outcome.rollTotal)) ? Number(outcome.rollTotal) : null,
    resultId: outcome.resultId ?? null,
    description: outcome.description ?? "",
    range: foundry.utils.deepClone(outcome.range ?? null)
  };
}

function rollInitialQuantity(mode) {
  if (mode === "bag-beans") return randomDie(4) + randomDie(4) + randomDie(4);
  if (mode === "deck-illusions") return 34 - (randomDie(20) - 1);
  if (mode === "d6-plus-1") return randomDie(6) + 1;
  if (mode === "deck-many-things") return Math.random() < 0.75 ? 13 : 22;
  return null;
}

function prayerChoiceFromOutcome(outcome) {
  const tokens = semanticTokensFromText(outcome?.description ?? "");
  const bead = choiceToken(tokens, "bead");
  const spellRef = referencedItemUuids(outcome?.description ?? "").find(ref => /\.spells(?:24)?\.Item\./i.test(ref.uuid));
  return bead ? { bead, spellUuid: spellRef?.uuid ?? null, label: `Bead of ${titleCase(bead.replaceAll("-", " "))}` } : null;
}

function robePatchLabel(outcome) {
  let label = tableOutcomeLabel(outcome);
  if (!label) return "";
  label = label
    .replace(/\s*\|\s*/g, " — ")
    .replace(/\s+/g, " ")
    .trim();
  return label;
}

async function reserveReadyResolution(item) {
  const spec = item?.resolutionSpec;
  if (!spec || item.materializationMode === "template") return null;

  if (spec.kind === "effect-table" || spec.kind === "legacy-resistance") {
    const outcome = await rollResolutionTable(spec.tableUuid);
    const damageType = choiceToken(semanticTokensFromText(outcome?.description ?? ""), "damage")
      ?? DAMAGE_TYPES.find(type => new RegExp(`\\b${type}\\b`, "i").test(tableOutcomeLabel(outcome)));
    if (!damageType) throw new Error(`EasyMagicItems could not resolve the damage type for ${item.name}.`);
    const resolution = { kind: spec.kind, status: "reserved", damageType, tableOutcome: compactTableOutcome(outcome) };
    resolution.previewName = previewResolvedReadyName(item, resolution);
    return resolution;
  }

  if (spec.kind === "legacy-vulnerability") {
    const damageType = randomChoice(PHYSICAL_DAMAGE_TYPES);
    return {
      kind: spec.kind,
      status: "reserved",
      damageType,
      previewName: `${item.name} — ${titleCase(damageType)} Resistance`
    };
  }

  if (spec.kind === "legacy-dragon-scale") {
    const variant = foundry.utils.deepClone(randomChoice(DRAGON_VARIANTS));
    return {
      kind: spec.kind,
      status: "reserved",
      dragon: variant.key,
      damageType: variant.damage,
      previewName: `${titleCase(variant.key)} Dragon Scale Mail`
    };
  }

  if (spec.kind === "activity-table") {
    const outcome = await rollResolutionTable(spec.tableUuid);
    const tokens = semanticTokensFromText(outcome?.description ?? "");
    const label = tableOutcomeLabel(outcome);
    return { kind: spec.kind, selector: spec.selector, status: "reserved", tokens, label, tableOutcome: compactTableOutcome(outcome) };
  }

  if (spec.kind === "legacy-manual") {
    const outcome = await rollResolutionTable(spec.tableUuid);
    let golem = choiceToken(semanticTokensFromText(outcome?.description ?? ""), "golem");
    if (!golem && Number.isFinite(outcome?.rollTotal)) {
      const total = Number(outcome.rollTotal);
      golem = total <= 5 ? "clay" : total <= 17 ? "flesh" : total === 18 ? "iron" : "stone";
    }
    if (!golem) throw new Error(`EasyMagicItems could not resolve the golem type for ${item.name}.`);
    return { kind: spec.kind, status: "reserved", golem, tableOutcome: compactTableOutcome(outcome), previewName: `${item.name} (${titleCase(golem)} Golem)` };
  }

  if (spec.kind === "replacement-choice") {
    const choice = randomChoice(spec.choices ?? []);
    if (!choice?.uuid) throw new Error(`EasyMagicItems could not resolve a concrete form for ${item.name}.`);
    return { kind: spec.kind, status: "reserved", replacementUuid: choice.uuid, previewName: choice.label || item.name };
  }

  if (spec.kind === "prayer-beads") {
    const count = randomDie(4) + 2;
    const choices = [];
    for (let i = 0; i < count; i += 1) {
      const outcome = await rollResolutionTable(spec.tableUuid);
      const choice = prayerChoiceFromOutcome(outcome);
      if (!choice) throw new Error(`EasyMagicItems could not resolve prayer bead ${i + 1}.`);
      choices.push(choice);
    }
    const counts = {};
    for (const choice of choices) counts[choice.bead] = (counts[choice.bead] ?? 0) + 1;
    return { kind: spec.kind, status: "reserved", count, choices, counts, previewName: item.name };
  }

  if (spec.kind === "robe-patches") {
    const extraCount = roll4d4();
    const patches = [];
    for (let i = 0; i < extraCount; i += 1) {
      const outcome = await rollResolutionTable(spec.tableUuid);
      if (!outcome) throw new Error(`EasyMagicItems could not resolve robe patch ${i + 1}.`);
      let label = robePatchLabel(outcome);
      if (!label) throw new Error(`EasyMagicItems received an empty Robe of Useful Items table result for ${item.name}.`);
      if (/spell scroll/i.test(label)) {
        const spells = (catalogCache?.spells ?? []).filter(spell => spell.level >= 1 && spell.level <= 3);
        const spell = randomChoice(spells);
        if (!spell) throw new Error(`EasyMagicItems could not resolve the spell scroll patch for ${item.name}.`);
        label = `Spell Scroll of ${spell.name}`;
      }
      patches.push({ label, tableOutcome: compactTableOutcome(outcome) });
    }
    const counts = {};
    for (const patch of patches) counts[patch.label] = (counts[patch.label] ?? 0) + 1;
    return { kind: spec.kind, status: "reserved", extraCount, patches, counts, previewName: item.name };
  }

  if (spec.kind === "initial-quantity") {
    const count = rollInitialQuantity(spec.mode);
    if (!Number.isFinite(count) || count < 1) throw new Error(`EasyMagicItems could not determine the starting quantity for ${item.name}.`);
    return {
      kind: spec.kind,
      status: "reserved",
      mode: spec.mode,
      unit: spec.unit ?? "uses",
      count,
      removeActivity: spec.removeActivity ?? null,
      previewName: item.name
    };
  }

  if (spec.kind === "legacy-candle") {
    const outcome = await rollResolutionTable(spec.tableUuid);
    const alignment = tableOutcomeLabel(outcome);
    if (!alignment) throw new Error(`EasyMagicItems could not determine the alignment for ${item.name}.`);
    return {
      kind: spec.kind,
      status: "reserved",
      alignment,
      tableOutcome: compactTableOutcome(outcome),
      previewName: `${item.name} (${alignment})`
    };
  }

  return null;
}

async function reserveVariant(item, filters = {}) {
  const reserved = foundry.utils.deepClone(item);

  if (reserved.materializationMode === "template" && reserved.profiles?.length) {
    const profiles = selectableProfiles(reserved, filters.rarities ?? []);
    const candidates = profiles.length ? profiles : reserved.profiles;
    let selectedProfile = null;
    let tableOutcome = null;
    if (reserved.resolutionSpec?.kind === "profile-table" && reserved.resolutionSpec?.tableUuid) {
      const selected = await selectProfileFromOfficialTable(reserved, candidates, reserved.resolutionSpec.tableUuid);
      selectedProfile = selected.profile;
      tableOutcome = selected.outcome;
    } else {
      selectedProfile = randomChoice(candidates);
    }
    if (selectedProfile) {
      reserved.selectedProfileId = selectedProfile.id;
      reserved.selectedProfileName = selectedProfile.name;
      reserved.selectedProfileRiders = foundry.utils.deepClone(selectedProfile.riders ?? {});
      reserved.selectedProfileSemantics = foundry.utils.deepClone(selectedProfile.primarySemantics?.length ? selectedProfile.primarySemantics : selectedProfile.semantics ?? []);
      const rarity = profileEffectiveRarity(reserved, selectedProfile);
      if (rarity) {
        reserved.rarity = rarity;
        reserved.rarityLabel = rarityLabel(rarity);
      }
      reserved.requiresAttunement = Boolean(reserved.requiresAttunement || selectedProfile.requiresAttunement);
      reserved.resolution = {
        kind: reserved.resolutionSpec?.kind ?? "template",
        status: "reserved",
        selectedProfileId: selectedProfile.id,
        selectedProfileName: selectedProfile.name,
        selectedProfileSemantics: foundry.utils.deepClone(reserved.selectedProfileSemantics),
        tableOutcome: compactTableOutcome(tableOutcome)
      };
    }
    return reserved;
  }

  const resolution = await reserveReadyResolution(reserved);
  if (resolution) {
    reserved.resolution = resolution;
    reserved.name = resolution.previewName || reserved.name;
  }
  return reserved;
}

async function reserveRandomItem(session, tokenUuid) {
  const candidates = viableCandidates(session, tokenUuid);
  const selected = randomChoice(candidates);
  if (!selected) return null;
  const reserved = await reserveVariant(selected, session.participantFilters?.[tokenUuid] ?? {});
  session.reserved ??= {};
  session.reserved[tokenUuid] = reserved;
  return reserved;
}

function parseScrollLevel(item) {
  const match = String(item?.name ?? "").match(/(?:level|,)?\s*(cantrip|[1-9](?:st|nd|rd|th)?)/i);
  if (!match) return null;
  return match[1].toLowerCase() === "cantrip" ? 0 : Number.parseInt(match[1], 10);
}

function isMagicItemTemplateDocument(document) {
  return Boolean(getSetupEnchantActivityData(document));
}

function isWeaponTemplateDocument(document) {
  return document?.type === "weapon" && isMagicItemTemplateDocument(document);
}

function isWeaponTemplateEntry(entry) {
  return entry?.category === "weapon" && entry?.materializationMode === "template";
}

function plainTextFromHtml(html) {
  const element = document.createElement("div");
  element.innerHTML = String(html ?? "");
  return element.textContent ?? "";
}

function compatibilityText(source) {
  const html = source?.description ?? String(getValue(source, "system.description.value", ""));
  return normalizeName(plainTextFromHtml(html).slice(0, 1100));
}

function sourceCategory(source) {
  if (source?.category) return source.category;
  return categorize(source, { setupActivity: getSetupEnchantActivityData(source) });
}

function sourceBaseItem(source) {
  return String(source?.baseItem ?? getValue(source, "system.type.baseItem", ""));
}

function sourceExplicitBaseUuids(source) {
  if (Array.isArray(source?.explicitBaseUuids) && source.explicitBaseUuids.length) return source.explicitBaseUuids;
  const description = source?.description ?? String(getValue(source, "system.description.value", ""));
  // Base forms are declared in the opening rules line. Limiting the scan keeps
  // later references (e.g. Belt of Giant Strength) from becoming base choices.
  return extractUuidReferences(String(description).slice(0, 1000)).map(ref => ref.uuid);
}

function baseCandidateMatchesCategory(base, category) {
  if (category === "weapon" || category === "staff") return base.documentType === "weapon";
  if (category === "armor") return base.documentType === "equipment" && ["light", "medium", "heavy", "natural"].includes(base.subtype);
  if (category === "shield") return base.documentType === "equipment" && base.subtype === "shield";
  if (category === "ammunition") return base.documentType === "consumable" && base.subtype === "ammo";
  if (category === "wand") return base.documentType === "equipment" && (/wand/.test(normalizeName(base.name)) || ["wand", "trinket"].includes(base.subtype));
  if (category === "ring") return base.documentType === "equipment" && (/ring/.test(normalizeName(base.name)) || base.subtype === "ring");
  if (category === "rod") return base.documentType === "equipment" && (/rod/.test(normalizeName(base.name)) || base.subtype === "rod");
  return true;
}

function compatibleBaseItems(template, baseItems, { fallback = true } = {}) {
  const category = sourceCategory(template);
  const text = compatibilityText(template);
  let candidates = baseItems.filter(base => baseCandidateMatchesCategory(base, category));
  if (!candidates.length) return [];

  const explicit = new Set(sourceExplicitBaseUuids(template));
  if (explicit.size) {
    const exact = candidates.filter(base => explicit.has(base.uuid));
    if (exact.length) return exact;
  }

  const baseItem = sourceBaseItem(template);
  if (baseItem) {
    const exactBase = candidates.filter(base => base.baseItem === baseItem);
    if (exactBase.length) return exactBase;
  }

  if (category === "weapon" || category === "staff") {
    const allowed = candidates.filter(weapon => {
      const name = normalizeName(weapon.name);
      const props = new Set((weapon.properties ?? []).map(normalizeName));
      if (/any sword|\bsword\b/.test(text) && !name.includes("sword") && !["rapier", "scimitar"].includes(weapon.baseItem)) return false;
      if (/\bbow\b/.test(text) && !name.includes("bow")) return false;
      if (/crossbow/.test(text) && !name.includes("crossbow")) return false;
      if (/melee weapon/.test(text) && ["simpleR", "martialR"].includes(weapon.subtype)) return false;
      if (/ranged weapon/.test(text) && !["simpleR", "martialR"].includes(weapon.subtype)) return false;
      if (/simple weapon/.test(text) && !String(weapon.subtype).startsWith("simple")) return false;
      if (/martial weapon/.test(text) && !String(weapon.subtype).startsWith("martial")) return false;
      if (/slashing/.test(text) && !props.has("slashing") && !["longsword","shortsword","greatsword","scimitar","glaive","halberd","greataxe","battleaxe","handaxe"].includes(weapon.baseItem)) return false;
      return true;
    });
    return allowed.length || !fallback ? allowed : candidates;
  }

  if (category === "armor") {
    const allowed = candidates.filter(armor => {
      if (/any medium or heavy/.test(text) && !["medium", "heavy"].includes(armor.subtype)) return false;
      if (/any light, medium, or heavy|any light medium or heavy/.test(text) && !["light", "medium", "heavy"].includes(armor.subtype)) return false;
      if (/\blight armor\b/.test(text) && armor.subtype !== "light") return false;
      if (/\bmedium armor\b/.test(text) && armor.subtype !== "medium") return false;
      if (/\bheavy armor\b/.test(text) && armor.subtype !== "heavy") return false;
      if (/except hide armor|except hide/.test(text) && armor.baseItem === "hide") return false;
      return true;
    });
    return allowed.length || !fallback ? allowed : candidates;
  }

  return candidates;
}

function compatibleBaseWeapons(template, baseWeapons, { fallback = true } = {}) {
  return compatibleBaseItems(template, baseWeapons, { fallback });
}

function itemAllowsSelectedWeapon(item, selectedWeaponUuid) {
  if (!selectedWeaponUuid || selectedWeaponUuid === "random" || item.category !== "weapon") return true;
  const base = (catalogCache?.baseWeapons ?? []).find(weapon => weapon.uuid === selectedWeaponUuid);
  if (!base) return false;
  if (isWeaponTemplateEntry(item)) {
    return compatibleBaseWeapons(item, catalogCache?.baseWeapons ?? [], { fallback: false })
      .some(weapon => weapon.uuid === base.uuid);
  }
  // Fixed-form magic weapons stay in the pool. A specific GM base choice only
  // keeps fixed-form weapons whose canonical base matches that choice.
  return Boolean(item.baseItem && base.baseItem && item.baseItem === base.baseItem);
}

function spellMatchesPreference(spell, preference, level) {
  if (spell.level !== level) return false;
  if (preference?.spellSchool && preference.spellSchool !== "random" && spell.school !== preference.spellSchool) return false;
  if (preference?.spellClass && preference.spellClass !== "random") {
    if (spell.classes?.length && !spell.classes.includes(preference.spellClass)) return false;
  }
  return true;
}

function finalPreference(session, tokenUuid) {
  return { ...(session.participantFilters?.[tokenUuid] ?? {}), ...(session.finalOverrides?.[tokenUuid] ?? {}) };
}

function resultNeedsFinalization(result) { return Boolean(result?.pendingFinal); }
function sessionComplete(session) {
  return session.participants.every(p => session.results?.[p.tokenUuid] && !resultNeedsFinalization(session.results[p.tokenUuid]));
}

class MagicItemDrawApplication extends Application {
  constructor(session, options = {}) {
    super(options);
    this.sessionId = session.id;
    this.uiWasHidden = false;
    this.activeSounds = new Set();
    this.soundTimers = new Set();
    this.introTimer = null;
    this.entranceTimers = new Set();
    this.playedCardCues = new Set();
    this.entranceComplete = false;
    this.openingSequencePlayed = false;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "easy-magic-items-window",
      title: "",
      template: TEMPLATE,
      classes: ["easy-magic-items-window"],
      width: "auto",
      height: "auto",
      resizable: true,
      minimizable: false,
      popOut: true,
      closeOnSubmit: false
    });
  }

  get session() { return sessions.get(this.sessionId); }

  async getData() {
    const session = this.session;
    const participants = [];
    const introComplete = Date.now() >= Number(session.introEndsAt ?? 0);

    for (const [participantIndex, participant] of session.participants.entries()) {
      const tokenDocument = await fromUuid(participant.tokenUuid);
      const actor = tokenDocument?.actor;
      const rawResult = session.results?.[participant.tokenUuid] ?? null;
      const result = rawResult ? { ...rawResult, rarityLabel: rarityLabel(rawResult.rarity), categoryLabel: categoryLabel(rawResult.category) } : null;
      const revealing = (session.revealing ?? []).includes(participant.tokenUuid);
      const preference = finalPreference(session, participant.tokenUuid);
      const baseChoice = preference.itemBase ?? (result?.category === "weapon" ? preference.weaponBase : "random") ?? "random";
      const finalKindTemplate = result?.finalKind === "template" || result?.finalKind === "weapon";
      const templateButtonLabel = result?.category === "weapon"
        ? i18n("EMI.Main.RollWeaponType")
        : i18n("EMI.Main.RollItemForm", "Roll Item Form");
      participants.push({
        ...participant,
        result,
        revealed: Boolean(result),
        revealing,
        entryAt: Number(session.windowOpensAt ?? Date.now())
          + CARD_SEQUENCE_DELAY_MS
          + (participantIndex * CARD_SEQUENCE_INTERVAL_MS),
        animateEntrance: !this.entranceComplete && !introComplete,
        canDraw: introComplete && !result && !revealing && (game.user.isGM || (actor?.isOwner && session.rollPermissions?.[participant.tokenUuid])),
        canOpenItem: Boolean(result) && !resultNeedsFinalization(result),
        canFinalize: Boolean(result?.pendingFinal) && !revealing && (game.user.isGM || actor?.isOwner),
        finalButtonLabel: result?.finalKind === "scroll" ? i18n("EMI.Main.RollSpell") : templateButtonLabel,
        finalKindTemplate,
        finalKindWeapon: result?.finalKind === "weapon" || (finalKindTemplate && result?.category === "weapon"),
        finalKindScroll: result?.finalKind === "scroll",
        baseLabel: result?.baseLabel ?? baseOptionLabel(result?.category),
        baseOptions: (result?.baseOptions ?? result?.weaponOptions ?? []).map(option => ({ ...option, selected: baseChoice === option.value })),
        weaponOptions: (result?.weaponOptions ?? []).map(option => ({ ...option, selected: baseChoice === option.value })),
        spellClassOptions: SPELL_CLASSES.map(value => ({ value, label: classLabel(value), selected: preference.spellClass === value })),
        spellSchoolOptions: SPELL_SCHOOLS.map(value => ({ value, label: schoolLabel(value), selected: preference.spellSchool === value })),
        drawDisabled: viableCandidates(session, participant.tokenUuid).length < 1,
        rollReleased: Boolean(session.rollPermissions?.[participant.tokenUuid]),
        canConfigure: game.user.isGM,
        recommendedPool: Boolean(session.recommendedPools?.[participant.tokenUuid]),
        poolRemaining: sessionPool(session, participant.tokenUuid).length,
        configureTitle: i18nFormat("EMI.Main.ConfigureCharacter", { name: participant.name })
      });
    }
    const revealedCount = session.participants.filter(p => session.results?.[p.tokenUuid] && !resultNeedsFinalization(session.results[p.tokenUuid])).length;
    const unseenUnion = new Set();
    for (const participant of session.participants) {
      for (const item of sessionPool(session, participant.tokenUuid)) unseenUnion.add(item.uuid);
    }
    return {
      isGM: game.user.isGM,
      introComplete,
      participants,
      revealedCount,
      totalCount: participants.length,
      progress: participants.length ? Math.round((revealedCount / participants.length) * 100) : 0,
      poolRemaining: unseenUnion.size,
      recommendedAll: session.participants.every(participant => Boolean(session.recommendedPools?.[participant.tokenUuid])),
      labels: {
        close: i18n("EMI.Common.Close"),
        arcaneTreasure: i18n("EMI.Main.ArcaneTreasure"),
        poolSummary: i18nFormat("EMI.Main.PoolSummary", { number: unseenUnion.size }),
        applyRecommendationsTitle: i18n("EMI.Main.ApplyRecommendationsTitle"),
        recommendedItemPools: i18n("EMI.Main.RecommendedItemPools"),
        applyEveryCharacter: i18n("EMI.Main.ApplyEveryCharacter"),
        recommendedPool: i18n("EMI.Main.RecommendedPool"),
        customPool: i18n("EMI.Main.CustomPool"),
        lockPlayerRoll: i18n("EMI.Main.LockPlayerRoll"),
        releasePlayerRoll: i18n("EMI.Main.ReleasePlayerRoll"),
        attunement: i18n("EMI.Common.Attunement"),
        finalPending: i18n("EMI.Main.FinalPending"),
        addedInventory: i18n("EMI.Main.AddedInventory"),
        deliveryFailed: i18n("EMI.Main.DeliveryFailed"),
        revealing: i18n("EMI.Main.Revealing"),
        revealItem: i18n("EMI.Main.RevealItem"),
        waiting: i18n("EMI.Main.Waiting"),
        openItemSheet: i18n("EMI.Common.OpenItemSheet"),
        gmControls: i18n("EMI.Main.GMControls"),
        available: i18n("EMI.Common.Available"),
        weapon: i18n("EMI.Common.Weapon"),
        class: i18n("EMI.Common.Class"),
        school: i18n("EMI.Common.School"),
        randomWeapon: i18n("EMI.Filter.RandomCompatibleWeapon"),
        randomBase: i18n("EMI.Filter.RandomCompatibleItem", "Random compatible form"),
        randomClass: i18n("EMI.Filter.RandomClass"),
        randomSchool: i18n("EMI.Filter.RandomSchool"),
        resetResult: i18n("EMI.Main.ResetResult")
      },
      cardLayoutClass: `emi-count-${Math.min(participants.length, MAX_PARTICIPANTS)}`
    };
  }

  hideFoundryUI() {
    if (document.body.classList.contains("emi-immersive-ui")) return;
    document.body.classList.add("emi-immersive-ui");
    this.uiWasHidden = true;
  }

  restoreFoundryUI() {
    if (!this.uiWasHidden) return;
    document.body.classList.remove("emi-immersive-ui");
    this.uiWasHidden = false;
  }

  async close(options = {}) {
    if (this._emiClosing) return;
    this._emiClosing = true;
    const { broadcast = true, playSound = true, ...closeOptions } = options;
    if (broadcast && game.user.isGM) game.socket.emit(SOCKET_NAME, { action: "close", sessionId: this.sessionId });
    const element = this.element?.[0] ?? this.element;
    element?.querySelector?.(".emi-overlay")?.classList.add("is-closing");

    if (this.introTimer) window.clearTimeout(this.introTimer);
    this.introTimer = null;
    for (const timer of this.soundTimers) window.clearTimeout(timer);
    this.soundTimers.clear();
    for (const timer of this.entranceTimers) window.clearTimeout(timer);
    this.entranceTimers.clear();

    const stoppingAudio = stopApplicationSounds(this, { fade: 420 });
    if (playSound) void playLocalSound("close");
    await Promise.allSettled([stoppingAudio, wait(CLOSE_FADE_MS)]);

    this.restoreFoundryUI();
    applications.delete(this.sessionId);
    if (game.user.isGM || options.clearSession) sessions.delete(this.sessionId);
    return super.close(closeOptions);
  }

  scheduleCardEntrances(html) {
    for (const timer of this.entranceTimers) window.clearTimeout(timer);
    this.entranceTimers.clear();

    const root = html?.[0] ?? html;
    const cards = [...(root?.querySelectorAll?.(".emi-card[data-entry-at]") ?? [])];
    const now = Date.now();
    const introEndsAt = Number(this.session?.introEndsAt ?? 0);

    if (!cards.length || this.entranceComplete || now >= introEndsAt) {
      this.entranceComplete = true;
      for (const card of cards) {
        card.classList.remove("emi-pending-entry", "emi-entering");
        card.classList.add("emi-static");
      }
      return;
    }

    const schedule = (callback, delay) => {
      const timer = window.setTimeout(() => {
        this.entranceTimers.delete(timer);
        callback();
      }, Math.max(0, delay));
      this.entranceTimers.add(timer);
      return timer;
    };

    const scheduleSound = (callback, delay) => {
      const timer = window.setTimeout(() => {
        this.soundTimers.delete(timer);
        callback();
      }, Math.max(0, delay));
      this.soundTimers.add(timer);
      return timer;
    };

    for (const card of cards) {
      const entryAt = Number(card.dataset.entryAt ?? 0);
      const tokenUuid = String(card.dataset.tokenUuid ?? "");
      const settledAt = entryAt + CARD_ENTRY_SETTLE_MS;

      card.classList.remove("emi-entering", "emi-static");

      if (!entryAt || now >= settledAt || (tokenUuid && this.playedCardCues.has(tokenUuid))) {
        card.classList.add("emi-static");
        if (tokenUuid) this.playedCardCues.add(tokenUuid);
        continue;
      }

      card.classList.add("emi-pending-entry");

      const enter = () => {
        if (this._emiClosing || !card.isConnected) return;

        const frame = card.querySelector(".emi-card-frame");
        if (!frame) {
          card.classList.remove("emi-pending-entry", "emi-entering");
          card.classList.add("emi-static");
          return;
        }

        // Run movement, frame light, aura, and sweep independently so Chromium
        // can compose each visual beat without property conflicts.
        let aura = card.querySelector(":scope > .emi-entry-aura");
        if (!aura) {
          aura = document.createElement("div");
          aura.className = "emi-entry-aura";
          aura.setAttribute("aria-hidden", "true");
          card.insertBefore(aura, frame);
        }

        let sweep = frame.querySelector(":scope > .emi-entry-sweep");
        if (!sweep) {
          sweep = document.createElement("div");
          sweep.className = "emi-entry-sweep";
          sweep.setAttribute("aria-hidden", "true");
          frame.appendChild(sweep);
        }

        for (const animation of [...card.getAnimations(), ...frame.getAnimations(), ...aura.getAnimations(), ...sweep.getAnimations()]) {
          animation.cancel();
        }

        card.classList.remove("emi-static");
        card.classList.add("emi-pending-entry", "emi-entering");

        const motion = card.animate([
          {
            offset: 0,
            opacity: 0,
            transform: "translate3d(0, 52px, 0) rotateY(-10deg) rotateZ(-1deg) scale(.94)",
            filter: "blur(2.4px)"
          },
          {
            offset: .18,
            opacity: .14,
            transform: "translate3d(0, 40px, 0) rotateY(-7deg) rotateZ(-.7deg) scale(.952)",
            filter: "blur(1.8px)"
          },
          {
            offset: .46,
            opacity: .62,
            transform: "translate3d(0, 17px, 0) rotateY(-2.5deg) rotateZ(-.2deg) scale(.982)",
            filter: "blur(.65px)"
          },
          {
            offset: .76,
            opacity: 1,
            transform: "translate3d(0, -3px, 0) rotateY(.8deg) rotateZ(.12deg) scale(1.006)",
            filter: "blur(0)"
          },
          {
            offset: 1,
            opacity: 1,
            transform: "translate3d(0, 0, 0) rotateY(0) rotateZ(0) scale(1)",
            filter: "blur(0)"
          }
        ], {
          duration: 820,
          easing: "cubic-bezier(.16,.74,.18,1)",
          fill: "both"
        });

        const framePulse = frame.animate([
          {
            offset: 0,
            borderColor: "#55798d",
            boxShadow: "0 16px 34px rgba(0,0,0,.52)"
          },
          {
            offset: .28,
            borderColor: "rgba(128,196,226,.92)",
            boxShadow: "0 0 7px rgba(174,229,250,.40), 0 16px 34px rgba(0,0,0,.52)"
          },
          {
            offset: .55,
            borderColor: "#effcff",
            boxShadow: "0 0 10px rgba(239,252,255,.98), 0 0 28px rgba(91,205,255,.92), 0 0 48px rgba(38,144,214,.48), 0 16px 34px rgba(0,0,0,.52)"
          },
          {
            offset: 1,
            borderColor: "#55798d",
            boxShadow: "0 16px 34px rgba(0,0,0,.52)"
          }
        ], {
          delay: 390,
          duration: 690,
          easing: "cubic-bezier(.18,.72,.2,1)",
          fill: "both"
        });

        const auraPulse = aura.animate([
          {
            offset: 0,
            opacity: 0,
            transform: "scale(.985)",
            borderColor: "rgba(180,232,255,0)",
            boxShadow: "0 0 0 rgba(91,205,255,0)"
          },
          {
            offset: .30,
            opacity: .42,
            transform: "scale(.996)",
            borderColor: "rgba(193,239,255,.58)",
            boxShadow: "0 0 12px rgba(181,236,255,.55), 0 0 24px rgba(91,205,255,.40)"
          },
          {
            offset: .55,
            opacity: 1,
            transform: "scale(1.008)",
            borderColor: "rgba(237,252,255,.98)",
            boxShadow: "0 0 12px rgba(239,252,255,.95), 0 0 30px rgba(91,205,255,.82), 0 0 54px rgba(38,144,214,.42)"
          },
          {
            offset: 1,
            opacity: 0,
            transform: "scale(1.018)",
            borderColor: "rgba(180,232,255,0)",
            boxShadow: "0 0 0 rgba(91,205,255,0)"
          }
        ], {
          delay: 390,
          duration: 690,
          easing: "ease-out",
          fill: "both"
        });

        const lightSweep = sweep.animate([
          { offset: 0, opacity: 0, transform: "translate3d(-190%,0,0) skewX(-18deg)" },
          { offset: .18, opacity: .82 },
          { offset: .70, opacity: .58 },
          { offset: 1, opacity: 0, transform: "translate3d(430%,0,0) skewX(-18deg)" }
        ], {
          delay: 420,
          duration: 620,
          easing: "cubic-bezier(.18,.72,.2,1)",
          fill: "both"
        });

        if (tokenUuid && !this.playedCardCues.has(tokenUuid)) {
          this.playedCardCues.add(tokenUuid);
          void playLocalSound("cardArrive", null, this);
          scheduleSound(() => void playLocalSound("cardFlip", null, this), CARD_FLIP_SOUND_OFFSET_MS);
        }

        const animations = [motion, framePulse, auraPulse, lightSweep];
        let finalized = false;
        const finalizeEntrance = () => {
          if (finalized) return;
          finalized = true;
          if (card.isConnected) {
            card.classList.remove("emi-entering", "emi-pending-entry");
            card.classList.add("emi-static");
          }
          for (const animation of animations) animation.cancel();
        };

        const fallbackTimer = schedule(finalizeEntrance, CARD_ENTRY_SETTLE_MS);
        Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
          window.clearTimeout(fallbackTimer);
          this.entranceTimers.delete(fallbackTimer);
          finalizeEntrance();
        });
      };

      if (now < entryAt) schedule(enter, entryAt - now);
      else window.requestAnimationFrame(() => window.requestAnimationFrame(enter));
    }
  }

  activateListeners(html) {
    super.activateListeners(html);
    this.hideFoundryUI();
    this.scheduleCardEntrances(html);

    const introEndsAt = Number(this.session?.introEndsAt ?? 0);
    if (Date.now() < introEndsAt && !this.introTimer) {
      this.introTimer = window.setTimeout(async () => {
        this.introTimer = null;
        this.entranceComplete = true;
        if (!this._emiClosing) await this.render(false);
      }, Math.max(0, introEndsAt - Date.now()) + 50);
    }

    html.find("[data-action='close']").on("click", () => this.close());
    html.find("[data-action='toggle-recommended-all']").on("click", async event => {
      if (!game.user.isGM) return;
      const button = event.currentTarget;
      if (button.disabled) return;
      button.disabled = true;
      try {
        const currentlyAll = this.session.participants.every(participant => Boolean(this.session.recommendedPools?.[participant.tokenUuid]));
        await applyRecommendedPoolsToSession(this.session, !currentlyAll);
      } catch (error) {
        console.error(`${MODULE_ID} | Could not change recommended pools`, error);
        ui.notifications.error(error.message);
      } finally {
        button.disabled = false;
      }
    });
    html.find("[data-action='draw']").on("click", async event => {
      const button = event.currentTarget;
      if (button.disabled) return;
      button.disabled = true;
      void playLocalSound("selectItem");
      await requestDraw(this.sessionId, button.dataset.tokenUuid);
    });
    html.find("[data-action='reroll']").on("click", async event => {
      if (!game.user.isGM) return;
      event.currentTarget.disabled = true;
      await gmReroll(this.sessionId, event.currentTarget.dataset.tokenUuid);
    });
    html.find("[data-action='toggle-roll-release']").on("click", async event => {
      if (!game.user.isGM) return;
      const session = this.session;
      const tokenUuid = event.currentTarget.dataset.tokenUuid;
      session.rollPermissions ??= {};
      const releasing = !session.rollPermissions[tokenUuid];
      session.rollPermissions[tokenUuid] = releasing;
      await syncSession(session, releasing ? "release" : null);
    });
    html.find("[data-action='configure-player']").on("click", async event => {
      if (!game.user.isGM) return;
      await openSessionParticipantConfiguration(this.sessionId, event.currentTarget.dataset.tokenUuid);
    });
    html.find("[data-action='open-item']").on("click", async event => {
      await openResultItem(this.sessionId, event.currentTarget.dataset.tokenUuid);
    });
    html.find("[data-action='finalize']").on("click", async event => {
      event.currentTarget.disabled = true;
      await requestFinalize(this.sessionId, event.currentTarget.dataset.tokenUuid);
    });
    html.find("[data-final-override]").on("change", async event => {
      if (!game.user.isGM) return;
      const session = this.session;
      const tokenUuid = event.currentTarget.dataset.tokenUuid;
      session.finalOverrides ??= {};
      session.finalOverrides[tokenUuid] ??= {};
      session.finalOverrides[tokenUuid][event.currentTarget.dataset.finalOverride] = event.currentTarget.value;
      await syncSession(session);
    });
  }
}

const SOUNDS = {
  open: { file: "open-crystals.ogg", volume: 0.44, channel: "environment" },
  openingMusic: { file: "opening-music.mp3", volume: 0.38, channel: "music" },
  cardArrive: { file: "card-arrive.mp3", volume: 0.80, channel: "interface" },
  cardFlip: { file: "card-flip.mp3", volume: 0.92, channel: "interface" },
  gmRelease: { file: "gm-release.ogg", volume: 0.58, channel: "interface" },
  selectItem: { file: "select-item.ogg", volume: 0.68, channel: "interface" },
  wheelSpin: { file: "wheel-spin.ogg", volume: 0.72, channel: "interface" },
  chestOpen: { file: "chest-open.ogg", volume: 0.70, channel: "environment" },
  reveal: { file: "item-reveal.ogg", volume: 0.72, channel: "interface" },
  close: { file: "window-close.ogg", volume: 1.0, channel: "interface" }
};

function audioPath(filename) {
  return `modules/${MODULE_ID}/assets/audio/${filename}`;
}

function soundsEnabled() {
  try { return Boolean(game.settings.get(MODULE_ID, SETTINGS.SOUND_ENABLED)); }
  catch (_error) { return true; }
}

function openingThemeEnabled() {
  if (!soundsEnabled()) return false;
  try { return Boolean(game.settings.get(MODULE_ID, SETTINGS.OPENING_THEME_ENABLED)); }
  catch (_error) { return true; }
}

function getAudioContext(channel = "interface") {
  return game.audio?.[channel] ?? game.audio?.interface ?? game.audio?.context ?? null;
}

function trackApplicationSound(sound, application) {
  if (!sound || !application?.activeSounds) return sound;

  if (typeof sound.then === "function") {
    void sound.then(resolved => {
      if (resolved) application.activeSounds.add(resolved);
    }).catch(() => {});
    return sound;
  }

  application.activeSounds.add(sound);
  return sound;
}

async function stopApplicationSounds(application, { fade = 100 } = {}) {
  const sounds = [...(application?.activeSounds ?? [])];
  application?.activeSounds?.clear();

  await Promise.allSettled(sounds.map(async sound => {
    if (!sound?.playing) return;
    await sound.stop?.({ fade });
  }));
}

async function playLocalSound(key, volumeOverride = null, application = null) {
  if (!soundsEnabled()) return false;
  const sound = SOUNDS[key];
  if (!sound) {
    console.warn(`${MODULE_ID} | Unknown sound effect: ${key}`);
    return false;
  }

  const volume = Number.isFinite(Number(volumeOverride)) && volumeOverride !== null
    ? Number(volumeOverride)
    : sound.volume;
  const src = audioPath(sound.file);
  const channel = sound.channel ?? "interface";

  try {
    const helper = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
    if (helper?.play) {
      const instance = helper.play({
        src,
        volume,
        autoplay: true,
        loop: false,
        channel
      }, false);
      trackApplicationSound(instance, application);
      return instance || true;
    }
  } catch (error) {
    console.warn(`${MODULE_ID} | One-shot audio failed; trying instance fallback.`, {
      key, src, error
    });
  }

  try {
    if (!game.audio?.create) return false;
    const instance = game.audio.create({
      src,
      context: getAudioContext(channel),
      singleton: false,
      preload: true,
      autoplay: true,
      autoplayOptions: { volume, loop: false }
    });
    trackApplicationSound(instance, application);
    return instance;
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not play sound: ${key}`, error);
    return false;
  }
}

function playOpeningSequence(application = null) {
  void playLocalSound("open", null, application);
  if (openingThemeEnabled()) void playLocalSound("openingMusic", null, application);
}

function playRollingSequence(application = null) {
  void playLocalSound("wheelSpin", null, application);
  const timer = window.setTimeout(() => {
    application?.soundTimers?.delete(timer);
    void playLocalSound("chestOpen", null, application);
  }, 900);
  application?.soundTimers?.add(timer);
}

async function openOrRefresh(session, { openingSound = false, sound = null } = {}) {
  sessions.set(session.id, session);
  let app = applications.get(session.id);
  if (!app) {
    app = new MagicItemDrawApplication(session);
    applications.set(session.id, app);
  }

  let playIntro = false;
  if (openingSound && !app.openingSequencePlayed) {
    app.openingSequencePlayed = true;
    const opensAt = Number(session.windowOpensAt ?? Date.now());
    const introEndsAt = Number(session.introEndsAt ?? opensAt);
    if (Date.now() < opensAt) await wait(opensAt - Date.now());
    playIntro = Date.now() < introEndsAt + 250;
  }

  await app.render(true);

  if (playIntro) playOpeningSequence(app);
  if (sound === "rolling") playRollingSequence(app);
  else if (sound === "reveal") void playLocalSound("reveal", null, app);
  else if (sound === "reroll") void playLocalSound("cardFlip", null, app);
  else if (sound === "release") void playLocalSound("gmRelease", null, app);
}

function sessionForSocket(session) {
  return {
    ...session,
    participantPools: Object.fromEntries(
      Object.entries(session.participantPools ?? {}).map(([tokenUuid, pool]) => [
        tokenUuid,
        pool.map(item => ({ uuid: item.uuid }))
      ])
    )
  };
}

async function syncSession(session, sound = null) {
  game.socket.emit(SOCKET_NAME, { action: "sync", session: sessionForSocket(session), sound });
  await openOrRefresh(session, { sound });
}

async function validateSender(userId, tokenUuid) {
  const user = game.users.get(userId);
  const tokenDocument = await fromUuid(tokenUuid);
  if (!user || !tokenDocument?.actor) return false;
  return user.isGM || tokenDocument.actor.testUserPermission(user, "OWNER");
}

async function requestDraw(sessionId, tokenUuid) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(i18n("EMI.Error.DrawUnavailable"));
  if (session.results?.[tokenUuid]) return;
  const tokenDocument = await fromUuid(tokenUuid);
  if (!tokenDocument?.actor) throw new Error(i18n("EMI.Error.CharacterNotFound"));
  if (!game.user.isGM && !tokenDocument.actor.isOwner) throw new Error(i18n("EMI.Error.NotOwner"));
  if (!game.user.isGM && !session.rollPermissions?.[tokenUuid]) throw new Error(i18n("EMI.Error.RollNotReleased"));
  const payload = { action: "draw", sessionId, tokenUuid, userId: game.user.id };
  if (game.user.isGM) await handleAsGM(payload);
  else game.socket.emit(SOCKET_NAME, payload);
}

async function requestFinalize(sessionId, tokenUuid) {
  const session = sessions.get(sessionId);
  const result = session?.results?.[tokenUuid];
  if (!result?.pendingFinal) return;
  const tokenDocument = await fromUuid(tokenUuid);
  if (!game.user.isGM && !tokenDocument?.actor?.isOwner) throw new Error(i18n("EMI.Error.NotOwner"));
  const payload = { action: "finalize", sessionId, tokenUuid, userId: game.user.id };
  if (game.user.isGM) await handleAsGM(payload);
  else game.socket.emit(SOCKET_NAME, payload);
}

async function removeGrantedItem(result) {
  if (!result?.grantedUuid) return;
  try {
    const granted = await fromUuid(result.grantedUuid);
    if (granted?.documentName === "Item" && granted.parent?.documentName === "Actor") await granted.delete();
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not remove the previously granted item`, error);
  }
}

async function gmReroll(sessionId, tokenUuid) {
  const session = sessions.get(sessionId);
  const previous = session?.results?.[tokenUuid];
  if (!game.user.isGM || !previous) return;

  // Check before clearing the result so the GM never strands the participant.
  if (!viableCandidates(session, tokenUuid).length) {
    return ui.notifications.warn(i18n("EMI.Error.NoUnseenItem"));
  }

  await removeGrantedItem(previous);
  session.summaryPosted = false;
  session.summaryPosting = false;
  delete session.results[tokenUuid];

  // Reroll now resets the card. The player gets to press Reveal Item again,
  // preserving the shared-table experience instead of auto-revealing for them.
  await syncSession(session, "reroll");
}

function randomDocumentId() {
  if (typeof foundry?.utils?.randomID === "function") return foundry.utils.randomID(16);
  return Math.random().toString(36).slice(2, 18).padEnd(16, "0").slice(0, 16);
}

function itemActivityData(itemData) {
  const raw = getValue(itemData, "system.activities", {});
  return collectionValues(raw);
}

function setItemActivities(itemData, activities) {
  const current = getValue(itemData, "system.activities", {});
  if (Array.isArray(current)) {
    foundry.utils.setProperty(itemData, "system.activities", activities);
    return;
  }
  const object = {};
  for (const activity of activities) {
    const id = String(activity?._id ?? activity?.id ?? randomDocumentId());
    activity._id = id;
    object[id] = activity;
  }
  foundry.utils.setProperty(itemData, "system.activities", object);
}

function setActivityEffects(activity, effectIds) {
  if (!activity || !("effects" in activity)) return;
  const current = collectionValues(activity.effects);
  activity.effects = current.filter(ref => effectIds.includes(String(ref?._id ?? ref?.id ?? ref ?? "")));
}

function appendResolutionSummary(itemData, title, lines = []) {
  const clean = lines.filter(Boolean);
  if (!clean.length) return;
  const current = String(getValue(itemData, "system.description.value", ""));
  const list = clean.map(line => `<li>${escapeHtml(line)}</li>`).join("");
  const section = `<hr><section class="easy-magic-items-resolution"><h3>${escapeHtml(title)}</h3><ul>${list}</ul></section>`;
  foundry.utils.setProperty(itemData, "system.description.value", `${current}${section}`);
}

function createTraitEffectData(name, changes, img = "icons/svg/aura.svg") {
  return {
    _id: randomDocumentId(),
    name,
    img,
    type: "base",
    disabled: false,
    transfer: true,
    system: {
      changes: changes.map(change => ({
        key: String(change.key),
        value: String(change.value),
        priority: null,
        type: change.type ?? "add",
        phase: change.phase ?? "initial"
      }))
    },
    duration: { value: null, units: "seconds", expiry: null, expired: false },
    description: "",
    origin: null,
    tint: "#ffffff",
    statuses: [],
    flags: {},
    sort: 0
  };
}

function sanitizeDamageChangesInData(itemData) {
  for (const effect of collectionValues(itemData?.effects ?? [])) {
    const paths = [];
    if (Array.isArray(effect?.system?.changes)) paths.push(effect.system.changes);
    if (Array.isArray(effect?.changes)) paths.push(effect.changes);
    for (const changes of paths) {
      for (const change of changes) {
        if (!["system.traits.dr.value", "system.traits.dv.value", "system.traits.di.value"].includes(String(change?.key ?? ""))) continue;
        const canonical = normalizeDamageType(change?.value);
        if (canonical) change.value = canonical;
      }
    }
  }
  return itemData;
}

function beadTypeForActivity(activity, resolution) {
  const direct = choiceToken(activitySemanticTokens(activity), "bead");
  if (direct) return direct;
  const spellUuid = String(activity?.spell?.uuid ?? "");
  if (!spellUuid) return null;
  const match = (resolution?.choices ?? []).find(choice => choice.spellUuid && choice.spellUuid === spellUuid);
  return match?.bead ?? null;
}

function resolvedActivityName(bead) {
  return `Bead of ${titleCase(String(bead ?? "").replaceAll("-", " "))}`;
}

function makeUtilityActivity(label, count, template = null) {
  const activity = foundry.utils.deepClone(template ?? {
    type: "utility",
    sort: 0,
    activation: { type: "action", value: null, override: false, condition: "" },
    consumption: { scaling: { allowed: false }, spellSlot: true, targets: [{ type: "activityUses", value: "1", scaling: {} }] },
    description: { chatFlavor: "" },
    duration: { units: "inst", concentration: false, override: false },
    effects: [],
    range: { override: false, units: "self", special: "" },
    target: { template: { contiguous: false, units: "ft", type: "", stationary: false }, affects: { choice: false, count: "", type: "" }, override: false, prompt: true },
    visibility: { requireMagic: true, level: { min: null, max: null }, identifier: "", requireAttunement: false, requireIdentification: false },
    flags: {}
  });
  activity._id = randomDocumentId();
  activity.name = label;
  activity.type = "utility";
  activity.uses = { ...(activity.uses ?? {}), spent: 0, recovery: [], max: String(count) };
  activity.consumption ??= { scaling: { allowed: false }, spellSlot: true, targets: [] };
  activity.consumption.targets = [{ type: "activityUses", value: "1", scaling: {} }];
  activity.effects = [];
  return activity;
}

function resolutionFlag(reserved, resolution, complete) {
  return {
    required: true,
    complete: Boolean(complete),
    kind: String(resolution?.kind ?? reserved?.resolutionSpec?.kind ?? reserved?.materializationMode ?? "unknown"),
    sourceUuid: reserved?.uuid ?? null,
    choice: foundry.utils.deepClone(resolution ?? null)
  };
}

function stampResolution(itemData, reserved, resolution, complete = true) {
  itemData.flags = foundry.utils.mergeObject(itemData.flags ?? {}, {
    [MODULE_ID]: { resolution: resolutionFlag(reserved, resolution, complete) }
  }, { inplace: false });
  return itemData;
}

function resolutionSourceEntry(sourceUuid) {
  return (catalogCache?.items ?? []).find(item => item.uuid === sourceUuid) ?? null;
}

function assertGrantResolution(sourceUuid, options = {}) {
  const source = resolutionSourceEntry(sourceUuid);
  if (!source?.resolutionRequired) return;
  if (options.staging) return;
  if (!options.resolutionComplete) {
    throw new Error(`EasyMagicItems blocked an unresolved magic item from being delivered: ${source.name}.`);
  }
}

function matchActivityForResolution(activity, resolution) {
  const tokens = new Set(activitySemanticTokens(activity));
  const nameTokens = new Set(semanticTokensFromText(activity?.name ?? ""));
  for (const wanted of resolution?.tokens ?? []) {
    if (tokens.has(wanted) || nameTokens.has(wanted)) return true;
  }
  if (resolution?.selector === "golem" && resolution?.label) {
    const wanted = choiceToken(semanticTokensFromText(resolution.label), "golem");
    if (wanted && (tokens.has(`golem:${wanted}`) || nameTokens.has(`golem:${wanted}`))) return true;
  }
  if (resolution?.selector === "size" && resolution?.label) {
    const wanted = choiceToken(semanticTokensFromText(resolution.label), "size");
    if (wanted && (tokens.has(`size:${wanted}`) || nameTokens.has(`size:${wanted}`))) return true;
  }
  return false;
}

async function resolveReadyItemData(sourceDocument, reserved) {
  if (!sourceDocument) throw new Error(i18n("EMI.Error.ItemSheetLoad"));
  const resolution = foundry.utils.deepClone(reserved?.resolution ?? null);
  const spec = reserved?.resolutionSpec;
  if (!spec || !resolution) {
    if (reserved?.resolutionRequired) throw new Error(`EasyMagicItems could not resolve ${reserved.name} before delivery.`);
    return { data: sourceDocument.toObject(), resolution: null, name: sourceDocument.name, img: sourceDocument.img };
  }

  if (spec.kind === "replacement-choice") {
    const replacement = await fromUuid(resolution.replacementUuid);
    if (!replacement || replacement.documentName !== "Item") throw new Error(`EasyMagicItems could not load the resolved form of ${reserved.name}.`);
    const data = replacement.toObject();
    appendResolutionSummary(data, "EasyMagicItems Resolution", [`Resolved form: ${replacement.name}`]);
    sanitizeDamageChangesInData(data);
    resolution.status = "validated";
    stampResolution(data, reserved, resolution, true);
    return { data, resolution, name: replacement.name, img: replacement.img };
  }

  const data = sourceDocument.toObject();
  let finalName = resolution.previewName || data.name || reserved.name;

  if (spec.kind === "effect-table") {
    const effects = collectionValues(data.effects ?? []);
    const wanted = `damage:${resolution.damageType}`;
    const selected = effects.find(effect => semanticTokensFromEffect(effect, effects).includes(wanted));
    if (!selected) throw new Error(`EasyMagicItems could not find the ${resolution.damageType} effect for ${reserved.name}.`);
    data.effects = [selected];
    for (const activity of itemActivityData(data)) setActivityEffects(activity, [String(selected._id ?? selected.id)]);
    finalName = resolution.previewName || `Potion of ${titleCase(resolution.damageType)} Resistance`;
    data.name = finalName;
    appendResolutionSummary(data, "Resolved Resistance", [`Damage type: ${titleCase(resolution.damageType)}`]);
  }

  if (spec.kind === "activity-table") {
    const activities = itemActivityData(data);
    const selected = activities.find(activity => matchActivityForResolution(activity, resolution));
    if (!selected) throw new Error(`EasyMagicItems could not identify the selected ${spec.selector} activity for ${reserved.name}.`);
    setItemActivities(data, [selected]);
    const tokens = semanticTokensFromText(`${resolution.label} ${selected.name ?? ""}`);
    if (spec.selector === "size") {
      const size = choiceToken(tokens, "size");
      finalName = size ? `Carpet of Flying (${size.replace("x", " × ")} ft.)` : `${reserved.name} (${resolution.label})`;
      appendResolutionSummary(data, "Resolved Carpet Size", [resolution.label || selected.name]);
    } else if (spec.selector === "golem") {
      const golem = choiceToken(tokens, "golem");
      finalName = golem ? `${reserved.name} (${titleCase(golem)} Golem)` : `${reserved.name} (${resolution.label})`;
      appendResolutionSummary(data, "Resolved Golem Type", [resolution.label || selected.name]);
    }
    data.name = finalName;
  }

  if (spec.kind === "legacy-manual") {
    finalName = resolution.previewName || `${reserved.name} (${titleCase(resolution.golem)} Golem)`;
    data.name = finalName;
    appendResolutionSummary(data, "Resolved Golem Type", [`${titleCase(resolution.golem)} Golem`]);
  }

  if (spec.kind === "legacy-resistance") {
    const type = normalizeDamageType(resolution.damageType);
    if (!type) throw new Error(`EasyMagicItems could not validate the resistance type for ${reserved.name}.`);
    const effect = createTraitEffectData(`${titleCase(type)} Resistance`, [{ key: "system.traits.dr.value", value: type }], `systems/dnd5e/icons/svg/damage/${type}.svg`);
    data.effects = [...collectionValues(data.effects ?? []), effect];
    finalName = resolution.previewName || previewResolvedReadyName(reserved, resolution);
    data.name = finalName;
    appendResolutionSummary(data, "Resolved Resistance", [`Damage type: ${titleCase(type)}`]);
  }

  if (spec.kind === "legacy-vulnerability") {
    const type = normalizeDamageType(resolution.damageType);
    if (!PHYSICAL_DAMAGE_TYPES.includes(type)) throw new Error(`EasyMagicItems could not validate the vulnerability armor type for ${reserved.name}.`);
    const other = PHYSICAL_DAMAGE_TYPES.filter(candidate => candidate !== type);
    const effect = createTraitEffectData(
      `Armor of Vulnerability — ${titleCase(type)} Resistance`,
      [
        { key: "system.traits.dr.value", value: type },
        ...other.map(value => ({ key: "system.traits.dv.value", value }))
      ],
      `systems/dnd5e/icons/svg/damage/${type}.svg`
    );
    data.effects = [...collectionValues(data.effects ?? []), effect];
    finalName = resolution.previewName || `${reserved.name} — ${titleCase(type)} Resistance`;
    data.name = finalName;
    appendResolutionSummary(data, "Resolved Damage Type", [
      `Resistance: ${titleCase(type)}`,
      `Curse vulnerability: ${other.map(titleCase).join(", ")}`
    ]);
  }

  if (spec.kind === "legacy-dragon-scale") {
    const type = normalizeDamageType(resolution.damageType);
    if (!type || !resolution.dragon) throw new Error(`EasyMagicItems could not validate the dragon type for ${reserved.name}.`);
    const effect = createTraitEffectData(`${titleCase(resolution.dragon)} Dragon Resistance`, [{ key: "system.traits.dr.value", value: type }], `systems/dnd5e/icons/svg/damage/${type}.svg`);
    data.effects = [...collectionValues(data.effects ?? []), effect];
    finalName = resolution.previewName || `${titleCase(resolution.dragon)} Dragon Scale Mail`;
    data.name = finalName;
    appendResolutionSummary(data, "Resolved Dragon Type", [`${titleCase(resolution.dragon)} dragon — ${titleCase(type)} resistance`]);
  }

  if (spec.kind === "prayer-beads") {
    const activities = itemActivityData(data);
    const kept = [];
    const covered = new Set();
    const legacyPrayer = reserved.packId === "dnd5e.items";
    const dawnRecovery = [{ period: "dawn", type: "recoverAll" }];

    if (legacyPrayer) {
      // In the 2014 SRD document the two Curing activities intentionally share
      // the Item uses pool, while the other bead types use activity-local uses.
      // Preserve that model so one Curing bead cannot be spent once on Cure
      // Wounds and again independently on Lesser Restoration.
      const curingCount = Number(resolution.counts?.curing ?? 0);
      data.system ??= {};
      data.system.uses = {
        ...(data.system.uses ?? {}),
        spent: 0,
        max: String(curingCount),
        recovery: dawnRecovery
      };
    }

    for (const activity of activities) {
      const bead = beadTypeForActivity(activity, resolution);
      const count = Number(resolution.counts?.[bead] ?? 0);
      if (!bead || count <= 0) continue;
      const copy = foundry.utils.deepClone(activity);
      if (!(legacyPrayer && bead === "curing")) {
        copy.uses = { ...(copy.uses ?? {}), spent: 0, max: String(count), recovery: dawnRecovery };
      } else {
        copy.uses = { ...(copy.uses ?? {}), spent: 0, max: "" };
      }
      if (!copy.name) copy.name = resolvedActivityName(bead);
      kept.push(copy);
      covered.add(bead);
    }
    const expected = Object.keys(resolution.counts ?? {}).filter(bead => resolution.counts[bead] > 0);
    if (!kept.length || expected.some(bead => !covered.has(bead))) {
      throw new Error(`EasyMagicItems could not map every prayer bead to an activity for ${reserved.name}.`);
    }
    setItemActivities(data, kept);
    appendResolutionSummary(data, "Resolved Magic Beads", expected.map(bead => `${resolvedActivityName(bead)} ×${resolution.counts[bead]}`));
  }

  if (spec.kind === "robe-patches") {
    const activities = itemActivityData(data);
    const named = activities.filter(activity => String(activity?.name ?? "").trim());
    const template = named.find(activity => activity.type === "utility") ?? activities.find(activity => activity.type === "utility") ?? null;
    const baseNames = ["Bullseye Lantern", "Dagger", "Mirror", "Pole", "Rope (Coiled)", "Sack"];
    const finalActivities = [];

    if (named.length >= 6) {
      for (const activity of named) {
        const copy = foundry.utils.deepClone(activity);
        copy.uses = { ...(copy.uses ?? {}), spent: 0, max: String(copy.uses?.max || 2) };
        finalActivities.push(copy);
      }
    } else {
      for (const name of baseNames) finalActivities.push(makeUtilityActivity(name, 2, template));
    }

    for (const [label, count] of Object.entries(resolution.counts ?? {})) {
      finalActivities.push(makeUtilityActivity(label, count, template));
    }
    setItemActivities(data, finalActivities);
    appendResolutionSummary(data, "Resolved Patches", [
      ...baseNames.map(name => `${name} ×2`),
      ...Object.entries(resolution.counts ?? {}).map(([label, count]) => `${label} ×${count}`)
    ]);
  }

  if (spec.kind === "initial-quantity") {
    const count = Number(resolution.count);
    if (!Number.isFinite(count) || count < 1) throw new Error(`EasyMagicItems could not validate the starting quantity for ${reserved.name}.`);
    data.system ??= {};
    if (!data.system.uses || typeof data.system.uses !== "object" || Array.isArray(data.system.uses)) {
      data.system.uses = { max: "", spent: 0, recovery: [] };
    }
    data.system.uses.max = String(count);
    data.system.uses.spent = 0;
    if (spec.removeActivity) {
      const activities = itemActivityData(data).filter(activity => normalizeName(activity?.name) !== normalizeName(spec.removeActivity));
      setItemActivities(data, activities);
    }
    appendResolutionSummary(data, "Resolved Starting Quantity", [`${count} ${resolution.unit ?? spec.unit ?? "uses"}`]);
  }

  if (spec.kind === "legacy-candle") {
    const alignment = String(resolution.alignment ?? "").trim();
    if (!alignment) throw new Error(`EasyMagicItems could not validate the alignment for ${reserved.name}.`);
    finalName = resolution.previewName || `${reserved.name} (${alignment})`;
    data.name = finalName;
    appendResolutionSummary(data, "Resolved Invocation Alignment", [`Alignment: ${alignment}`]);
  }

  sanitizeDamageChangesInData(data);
  resolution.status = "validated";
  stampResolution(data, reserved, resolution, true);

  const activities = itemActivityData(data);
  if (spec.kind === "activity-table" && activities.length !== 1) throw new Error(`EasyMagicItems validation blocked unresolved activities on ${reserved.name}.`);
  if (spec.kind === "effect-table" && collectionValues(data.effects ?? []).length !== 1) throw new Error(`EasyMagicItems validation blocked unresolved effects on ${reserved.name}.`);
  if (["legacy-resistance", "legacy-vulnerability", "legacy-dragon-scale"].includes(spec.kind) && !collectionValues(data.effects ?? []).length) {
    throw new Error(`EasyMagicItems validation blocked an unresolved trait on ${reserved.name}.`);
  }
  if (spec.kind === "initial-quantity" && Number(data.system?.uses?.max ?? 0) !== Number(resolution.count)) {
    throw new Error(`EasyMagicItems validation blocked an unresolved starting quantity on ${reserved.name}.`);
  }
  if (spec.kind === "legacy-candle" && !String(resolution.alignment ?? "").trim()) {
    throw new Error(`EasyMagicItems validation blocked an unresolved invocation alignment on ${reserved.name}.`);
  }

  return { data, resolution, name: data.name || finalName, img: data.img || reserved.img };
}

async function createItemForParticipant(session, tokenUuid, itemData, sourceUuid, options = {}) {
  if (!session.autoGrant || !itemData) return null;
  assertGrantResolution(sourceUuid, options);
  const participant = session.participants.find(entry => entry.tokenUuid === tokenUuid);
  const actor = participant?.actorUuid ? await fromUuid(participant.actorUuid) : null;
  if (!actor || actor.documentName !== "Actor") throw new Error(i18n("EMI.Error.ActorLoad"));
  const data = foundry.utils.deepClone(itemData);
  delete data._id; delete data.folder; delete data.ownership; delete data._stats;
  data.flags = foundry.utils.mergeObject(data.flags ?? {}, {
    [MODULE_ID]: {
      grantedBySession: session.id,
      sourceUuid,
      participantTokenUuid: tokenUuid,
      ...(options.staging ? { stagingResolution: true } : {})
    }
  }, { inplace: false });
  const [created] = await actor.createEmbeddedDocuments("Item", [data], { keepId: false });
  return created ?? null;
}

async function grantItemToParticipant(session, tokenUuid, sourceDocument, options = {}) {
  return createItemForParticipant(session, tokenUuid, sourceDocument?.toObject(), sourceDocument?.uuid, options);
}

function activityId(activity) {
  return String(activity?._id ?? activity?.id ?? "");
}

function findSetupActivity(document, preferredId = "") {
  const activities = getRawActivities(document);
  if (preferredId) {
    const preferred = activities.find(activity => activityId(activity) === preferredId);
    if (preferred && isSetupEnchantActivityData(preferred)) return preferred;
  }
  return activities.find(isSetupEnchantActivityData) ?? null;
}

function profileEffect(document, profileId) {
  return getRawEffects(document).find(effect => String(effect?._id ?? effect?.id ?? "") === String(profileId ?? "")) ?? null;
}

function previewMaterializedName(template, profileId, baseName) {
  const effect = profileEffect(template, profileId);
  const nameChange = effectChanges(effect).find(change => String(change?.key ?? "") === "name");
  const value = String(nameChange?.value ?? "");
  if (value.includes("{}")) return value.replaceAll("{}", baseName).trim();
  if (value && String(nameChange?.type ?? "") === "add") return `${baseName}${value}`.trim();
  if (effect?.name && !/^weapon\s*[+]|^armor\s*[+]|^shield\s*[+]|^ammunition\s*[+]/i.test(effect.name)) {
    return `${effect.name} (${baseName})`;
  }
  return `${baseName} — ${effect?.name ?? template?.name ?? i18n("EMI.Common.UnnamedItem")}`;
}

function baseOptionLabel(category) {
  if (category === "weapon" || category === "staff") return i18n("EMI.Common.Weapon", "Weapon");
  if (category === "armor") return i18n("EMI.Common.Armor", "Armor");
  if (category === "shield") return i18n("EMI.Common.Shield", "Shield");
  if (category === "ammunition") return i18n("EMI.Common.Ammunition", "Ammunition");
  return i18n("EMI.Common.ItemForm", "Item form");
}

async function finalizeReservedItem(session, tokenUuid) {
  const selected = session.reserved?.[tokenUuid];
  if (!selected) return null;
  let sourceDocument = null;
  try {
    sourceDocument = await fromUuid(selected.uuid);
  } catch (error) {
    console.error(`${MODULE_ID} | Could not load the selected compendium item`, error);
  }

  const pendingTemplate = selected.materializationMode === "template" || isMagicItemTemplateDocument(sourceDocument);
  const scrollLevel = selected.category === "scroll" ? parseScrollLevel(selected) : null;
  const pendingScroll = scrollLevel !== null && scrollLevel !== undefined;

  session.usedUuids ??= [];
  session.usedUuids.push(selected.uuid);
  delete session.reserved[tokenUuid];
  session.results ??= {};

  if (pendingTemplate || pendingScroll) {
    const compatible = pendingTemplate
      ? compatibleBaseItems(sourceDocument ?? selected, catalogCache?.baseItems ?? [], { fallback: true })
      : [];
    if (pendingTemplate && !compatible.length) {
      throw new Error(i18nFormat("EMI.Error.NoCompatibleBaseItem", { item: selected.name }, `No compatible base item was found for ${selected.name}.`));
    }
    session.results[tokenUuid] = {
      uuid: selected.uuid,
      sourceName: selected.name,
      name: selected.selectedProfileName || selected.name,
      img: selected.img,
      rarity: selected.rarity,
      rarityLabel: rarityLabel(selected.rarity),
      category: selected.category,
      categoryLabel: categoryLabel(selected.category),
      requiresAttunement: selected.requiresAttunement,
      packLabel: selected.packLabel,
      pendingFinal: true,
      finalKind: pendingTemplate ? "template" : "scroll",
      scrollLevel,
      setupActivityId: selected.setupActivityId || activityId(findSetupActivity(sourceDocument)),
      selectedProfileId: selected.selectedProfileId || null,
      selectedProfileName: selected.selectedProfileName || null,
      selectedProfileRiders: foundry.utils.deepClone(selected.selectedProfileRiders ?? {}),
      selectedProfileSemantics: foundry.utils.deepClone(selected.selectedProfileSemantics ?? []),
      resolutionSpec: foundry.utils.deepClone(selected.resolutionSpec ?? null),
      resolution: foundry.utils.deepClone(selected.resolution ?? null),
      baseCategory: selected.category,
      baseLabel: baseOptionLabel(selected.category),
      baseOptions: compatible.map(base => ({ value: base.uuid, label: base.name })),
      // Legacy aliases retained so an in-progress 1.0.x session can still render.
      weaponOptions: selected.category === "weapon" ? compatible.map(base => ({ value: base.uuid, label: base.name })) : null
    };
    return selected;
  }

  let granted = null; let grantFailed = false;
  let ready = null;
  try {
    if (selected.resolutionRequired) {
      ready = await resolveReadyItemData(sourceDocument, selected);
      granted = await createItemForParticipant(session, tokenUuid, ready.data, selected.uuid, { resolutionComplete: true });
    } else {
      granted = await grantItemToParticipant(session, tokenUuid, sourceDocument, { resolutionComplete: true });
    }
  } catch (error) {
    grantFailed = Boolean(session.autoGrant);
    console.error(`${MODULE_ID} | Inventory delivery failed`, error);
    if (selected.resolutionRequired) throw error;
  }
  session.results[tokenUuid] = {
    uuid: selected.uuid, grantedUuid: granted?.uuid ?? null, grantFailed,
    name: ready?.name ?? selected.name, img: ready?.img ?? selected.img, rarity: selected.rarity, rarityLabel: rarityLabel(selected.rarity),
    category: selected.category, categoryLabel: categoryLabel(selected.category),
    requiresAttunement: selected.requiresAttunement, packLabel: selected.packLabel,
    resolution: foundry.utils.deepClone(ready?.resolution ?? selected.resolution ?? null)
  };
  return selected;
}

function compatibleBaseForResult(result, template) {
  return compatibleBaseItems(template, catalogCache?.baseItems ?? [], { fallback: true });
}

async function createLegacyEnchantment(template, profileId, created) {
  const effect = profileEffect(template, profileId);
  if (!effect) throw new Error(i18n("EMI.Error.EnchantmentProfileMissing", "The selected enchantment profile could not be found."));
  const effectData = effect.toObject ? effect.toObject() : foundry.utils.deepClone(effect);
  delete effectData._id;
  effectData.disabled = false;
  effectData.transfer = true;
  effectData.origin = template.uuid;
  foundry.utils.setProperty(effectData, "flags.dnd5e.enchantmentProfile", profileId);
  const [enchantment] = await created.createEmbeddedDocuments("ActiveEffect", [effectData]);
  return enchantment;
}

async function materializeEnchantmentRiders(enchantment, activity, profileId) {
  if (!enchantment) return false;
  const options = { dnd5e: { enchantmentProfile: profileId, activityId: activityId(activity) } };
  if (typeof enchantment.system?.collectRiders === "function" && typeof foundry.documents?.modifyBatch === "function") {
    const batch = await enchantment.system.collectRiders(options);
    if (batch?.length) await foundry.documents.modifyBatch(batch);
    return true;
  }
  if (typeof enchantment.createRiderEnchantments === "function") {
    await enchantment.createRiderEnchantments(options);
    return true;
  }
  return false;
}


async function sanitizeCreatedItemDamageChanges(item) {
  if (!item?.effects) return;
  for (const effect of item.effects) {
    const changes = collectionValues(effect?.system?.changes ?? effect?.changes ?? []);
    let dirty = false;
    const next = changes.map(change => {
      const copy = foundry.utils.deepClone(change);
      if (["system.traits.dr.value", "system.traits.dv.value", "system.traits.di.value"].includes(String(copy?.key ?? ""))) {
        const canonical = normalizeDamageType(copy?.value);
        if (canonical && canonical !== copy.value) {
          copy.value = canonical;
          dirty = true;
        }
      }
      return copy;
    });
    if (!dirty) continue;
    try {
      if (effect.system?.changes !== undefined) await effect.update({ "system.changes": next });
      else await effect.update({ changes: next });
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not sanitize damage-type spelling on ${effect.name}`, error);
    }
  }
}

function createdItemSemanticTokens(item) {
  const tokens = new Set(semanticTokensFromText(item?.name ?? ""));
  const effects = collectionValues(item?.effects ?? []);
  for (const effect of effects) {
    for (const token of semanticTokensFromEffect(effect, effects)) tokens.add(token);
  }
  for (const activity of collectionValues(item?.system?.activities ?? [])) {
    for (const token of activitySemanticTokens(activity)) tokens.add(token);
  }
  return [...tokens];
}

function validateCreatedProfileSemantics(created, expected = []) {
  const meaningful = (expected ?? []).filter(token => /^(?:damage|creature|dragon|bonus):/.test(token));
  if (!meaningful.length) return true;
  const actual = new Set(createdItemSemanticTokens(created));
  return meaningful.some(token => actual.has(token));
}

async function markCreatedResolutionComplete(created, result, profileId, base) {
  if (!created) return;
  const resolution = foundry.utils.deepClone(result?.resolution ?? {
    kind: result?.resolutionSpec?.kind ?? "template",
    selectedProfileId: profileId,
    selectedProfileName: result?.selectedProfileName ?? null
  });
  resolution.status = "validated";
  resolution.selectedProfileId = profileId;
  resolution.baseUuid = base?.uuid ?? null;
  resolution.baseName = base?.name ?? null;
  await created.update({
    [`flags.${MODULE_ID}.stagingResolution`]: false,
    [`flags.${MODULE_ID}.resolution`]: {
      required: true,
      complete: true,
      kind: resolution.kind ?? "template",
      sourceUuid: result?.uuid ?? null,
      choice: resolution
    }
  });
}

function enchantmentErrorMessage(errors, template, base) {
  const list = Array.isArray(errors) ? errors : [];
  const message = list.map(error => error?.message ?? String(error ?? "")).filter(Boolean).join("; ");
  return message || i18nFormat("EMI.Error.ItemIncompatible", { template: template?.name, base: base?.name }, `${template?.name} is not compatible with ${base?.name}.`);
}

async function materializeMagicItem(session, tokenUuid, result) {
  const template = await fromUuid(result.uuid);
  if (!template) throw new Error(i18n("EMI.Error.ItemSheetLoad"));
  const activity = findSetupActivity(template, result.setupActivityId);
  if (!activity) throw new Error(i18n("EMI.Error.EnchantmentActivityMissing", "The setup enchantment activity could not be found."));

  const profiles = buildEnchantmentProfiles(template, activity);
  const profileId = result.selectedProfileId;
  if (!profileId || !profiles.some(profile => profile.id === profileId)) {
    throw new Error(i18n("EMI.Error.EnchantmentProfileMissing", "The reserved enchantment profile could not be found. Delivery was blocked instead of choosing a new variant at grant time."));
  }

  const preference = finalPreference(session, tokenUuid);
  let compatible = compatibleBaseForResult(result, template);
  if (result.category === "weapon" && preference.allowedWeaponBases?.length) {
    compatible = compatible.filter(base => preference.allowedWeaponBases.includes(base.uuid));
  }

  const preferredBaseUuid = preference.itemBase && preference.itemBase !== "random"
    ? preference.itemBase
    : (result.category === "weapon" && preference.weaponBase && preference.weaponBase !== "random" ? preference.weaponBase : null);

  let base = preferredBaseUuid ? (catalogCache?.baseItems ?? []).find(item => item.uuid === preferredBaseUuid) : null;
  if (base && !compatible.some(candidate => candidate.uuid === base.uuid)) {
    throw new Error(i18nFormat("EMI.Error.ItemIncompatible", { template: template.name, base: base.name }, `${template.name} is not compatible with ${base.name}.`));
  }
  if (!base) {
    if (result.category === "weapon") {
      base = weightedChoice(compatible, weapon => {
        if (preference.preferredWeaponBases?.includes(weapon.uuid)) return 6;
        return preferredWeaponWeight(weapon, preference.recommendationProfile);
      });
    } else base = randomChoice(compatible);
  }
  if (!base) throw new Error(i18nFormat("EMI.Error.NoCompatibleBaseItem", { item: template.name }, `No compatible base item was found for ${template.name}.`));

  const baseDocument = await fromUuid(base.uuid);
  if (!baseDocument) throw new Error(i18n("EMI.Error.BaseItemLoad", "The selected base item could not be loaded."));
  const previewName = previewMaterializedName(template, profileId, base.name);

  const created = await createItemForParticipant(session, tokenUuid, baseDocument.toObject(), template.uuid, { staging: true });
  if (!created) {
    return { uuid: template.uuid, grantedUuid: null, name: previewName, img: template.img || base.img };
  }

  try {
    let enchantment = null;
    if (typeof activity.canEnchant === "function") {
      const validation = activity.canEnchant(created);
      if (Array.isArray(validation) && validation.length) throw new Error(enchantmentErrorMessage(validation, template, base));
    }

    if (typeof activity.applyEnchantment === "function") {
      enchantment = await activity.applyEnchantment(profileId, created, { strict: false });
      if (!enchantment) throw new Error(i18n("EMI.Error.EnchantmentApplyFailed", "D&D5e did not apply the selected enchantment."));
    } else {
      enchantment = await createLegacyEnchantment(template, profileId, created);
    }

    const ridersHandled = await materializeEnchantmentRiders(enchantment, activity, profileId);
    const selectedProfile = profiles.find(profile => profile.id === profileId);
    const hasRiders = Object.values(selectedProfile?.riders ?? {}).some(entries => collectionValues(entries).length);
    if (hasRiders && !ridersHandled) {
      console.warn(`${MODULE_ID} | The selected enchantment has riders, but this D&D5e version exposes no rider materialization API.`);
    }

    const appliedProfile = enchantment?.flags?.dnd5e?.enchantmentProfile
      ?? getValue(enchantment, "flags.dnd5e.enchantmentProfile", null);
    if (appliedProfile && appliedProfile !== profileId) {
      throw new Error(i18n("EMI.Error.EnchantmentValidationFailed", "The created item received a different enchantment profile than requested."));
    }

    await sanitizeCreatedItemDamageChanges(created);
    if (!validateCreatedProfileSemantics(created, result.selectedProfileSemantics ?? selectedProfile?.primarySemantics ?? [])) {
      throw new Error(i18n("EMI.Error.EnchantmentValidationFailed", "The created item does not match the reserved enchantment variant."));
    }
    await markCreatedResolutionComplete(created, result, profileId, base);

    return {
      uuid: template.uuid,
      grantedUuid: created.uuid,
      name: created.name || previewName,
      img: created.img || template.img || base.img,
      selectedProfileId: profileId,
      baseUuid: base.uuid,
      baseName: base.name
    };
  } catch (error) {
    try { await created.delete(); } catch (cleanupError) {
      console.warn(`${MODULE_ID} | Could not clean up a partially materialized magic item`, cleanupError);
    }
    throw error;
  }
}

async function materializeScroll(session, tokenUuid, result) {
  const preference = finalPreference(session, tokenUuid);
  const candidates = (catalogCache?.spells ?? []).filter(spell => spellMatchesPreference(spell, preference, result.scrollLevel));
  const spell = randomChoice(candidates);
  if (!spell) throw new Error(i18n("EMI.Error.NoMatchingSpell"));
  const spellDocument = await fromUuid(spell.uuid);
  let scrollData = null;
  const Item5e = globalThis.dnd5e?.documents?.Item5e;
  if (Item5e?.createScrollFromCompendiumSpell && String(spell.uuid).startsWith("Compendium.")) {
    try {
      const generated = await Item5e.createScrollFromCompendiumSpell(spell.uuid, { dialog: false, level: result.scrollLevel });
      scrollData = generated?.toObject ? generated.toObject() : generated;
    } catch (error) {
      console.warn(`${MODULE_ID} | createScrollFromCompendiumSpell failed; falling back to createScrollFromSpell.`, error);
    }
  }
  if (!scrollData && Item5e?.createScrollFromSpell) {
    const createScroll = async () => Item5e.createScrollFromSpell(
      spellDocument,
      {},
      { dialog: false, level: result.scrollLevel }
    );
    const queued = scrollCreationQueue.then(createScroll, createScroll);
    scrollCreationQueue = queued.catch(() => undefined);
    const generated = await queued;
    scrollData = generated?.toObject ? generated.toObject() : generated;
  }
  if (!scrollData) {
    const template = await fromUuid(result.uuid);
    scrollData = template.toObject();
    scrollData.name = i18nFormat("EMI.Common.SpellScrollOf", { spell: spellDocument.name });
    scrollData.img = spellDocument.img || template.img;
    foundry.utils.setProperty(
      scrollData,
      "system.description.value",
      `<h2>${escapeHtml(spellDocument.name)}</h2>${getValue(spellDocument, "system.description.value", "")}`
    );
  }
  const created = await createItemForParticipant(session, tokenUuid, scrollData, spellDocument.uuid);
  return { uuid: spellDocument.uuid, grantedUuid: created?.uuid ?? null, name: created?.name ?? scrollData.name ?? i18nFormat("EMI.Common.SpellScrollOf", { spell: spell.name }), img: created?.img ?? scrollData.img ?? spell.img };
}

async function finalizeTemplateResult(session, tokenUuid) {
  const result = session.results?.[tokenUuid];
  if (!result?.pendingFinal) return;
  const final = result.finalKind === "scroll"
    ? await materializeScroll(session, tokenUuid, result)
    : await materializeMagicItem(session, tokenUuid, result);
  Object.assign(result, final, {
    pendingFinal: false,
    finalizedFromUuid: result.uuid,
    finalKind: null,
    baseOptions: null,
    weaponOptions: null,
    grantFailed: Boolean(session.autoGrant && !final.grantedUuid)
  });
}

async function handleAsGM(payload) {
  const session = sessions.get(payload.sessionId);
  if (!session || session.createdBy !== game.user.id) return;
  if (!(await validateSender(payload.userId, payload.tokenUuid))) return;
  if (!session.participants.some(p => p.tokenUuid === payload.tokenUuid)) return;

  if (payload.action === "finalize") {
    const result = session.results?.[payload.tokenUuid];
    if (!result?.pendingFinal || (session.revealing ?? []).includes(payload.tokenUuid)) return;
    session.revealing ??= [];
    session.revealing.push(payload.tokenUuid);
    await syncSession(session, "rolling");
    let finalized = false;
    try {
      await new Promise(resolve => setTimeout(resolve, FINAL_REVEAL_DELAY_MS));
      await finalizeTemplateResult(session, payload.tokenUuid);
      finalized = true;
    } catch (error) {
      console.error(`${MODULE_ID} | Final item creation failed`, error);
      ui.notifications.error(error.message);
    } finally {
      session.revealing = session.revealing.filter(uuid => uuid !== payload.tokenUuid);
      await syncSession(session, finalized ? "reveal" : null);
    }
    if (finalized) await postFinalSummary(session);
    return;
  }

  if (payload.action !== "draw" || session.results?.[payload.tokenUuid] || (session.revealing ?? []).includes(payload.tokenUuid)) return;
  const reserved = await reserveRandomItem(session, payload.tokenUuid);
  if (!reserved) return ui.notifications.warn(i18n("EMI.Error.NoUnseenItem"));
  session.revealing ??= [];
  session.revealing.push(payload.tokenUuid);
  await syncSession(session, "rolling");
  let revealed = false;
  try {
    await new Promise(resolve => setTimeout(resolve, REVEAL_DELAY_MS));
    await finalizeReservedItem(session, payload.tokenUuid);
    revealed = true;
  } catch (error) {
    console.error(`${MODULE_ID} | Item reveal failed`, error);
    delete session.reserved?.[payload.tokenUuid];
    ui.notifications.error(error.message);
  } finally {
    session.revealing = session.revealing.filter(uuid => uuid !== payload.tokenUuid);
    await syncSession(session, revealed ? "reveal" : null);
  }
  if (revealed) await postFinalSummary(session);
}

async function openResultItem(sessionId, tokenUuid) {
  const session = sessions.get(sessionId);
  const result = session?.results?.[tokenUuid];
  const participant = session?.participants?.find(entry => entry.tokenUuid === tokenUuid);
  if (!result?.uuid || !participant) return;

  let item = result.grantedUuid ? await fromUuid(result.grantedUuid) : null;
  if (!item) item = await fromUuid(result.uuid);
  if (!item) return ui.notifications.warn(i18n("EMI.Error.ItemSheetLoad"));

  // Always render a temporary owner-readable preview. This lets every player inspect
  // every revealed result without changing ownership of compendium or inventory items,
  // and it avoids actor ability/proficiency bonuses leaking into weapon previews.
  try {
    const data = item.toObject();
    delete data._id;
    delete data.folder;
    delete data._stats;
    data.ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
    const ItemClass = CONFIG.Item.documentClass;
    const preview = new ItemClass(data, { parent: null });
    preview.sheet.render(true);
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not create an owner-readable item preview`, error);
    ui.notifications.warn(i18n("EMI.Error.ItemSheetLoad"));
  }
}

async function postFinalSummary(session) {
  if (!game.user.isGM || !session.postToChat || session.summaryPosted || session.summaryPosting) return;
  if (!sessionComplete(session)) return;
  session.summaryPosting = true;
  try {
    const rows = session.participants.map(participant => {
      const item = session.results[participant.tokenUuid];
      const linkUuid = item.uuid;
      const itemLink = linkUuid ? `@UUID[${linkUuid}]{${item.name}}` : escapeHtml(item.name);
      return `<div class="emi-chat-row"><img src="${escapeHtml(item.img)}"><div><strong>${escapeHtml(participant.name)}</strong><span>${itemLink}</span><small>${escapeHtml(rarityLabel(item.rarity))} · ${escapeHtml(categoryLabel(item.category))}${item.requiresAttunement ? ` · ${escapeHtml(i18n("EMI.Common.Attunement"))}` : ""}</small></div></div>`;
    }).join("");
    await ChatMessage.create({
      speaker: { alias: "EasyMagicItems" },
      flags: { [MODULE_ID]: { summary: true, sessionId: session.id } },
      content: `<section class="emi-chat-summary"><h2>${i18n("EMI.Summary")}</h2>${rows}</section>`,
      whisper: []
    });
    session.summaryPosted = true;
    game.socket.emit(SOCKET_NAME, { action: "sync", session });
  } finally {
    session.summaryPosting = false;
  }
}

async function onSocket(payload) {
  if (!payload?.action) return;
  if (payload.action === "start") return openOrRefresh(payload.session, { openingSound: true });
  if (payload.action === "draw" || payload.action === "finalize") {
    if (game.user.isGM) await handleAsGM(payload);
    return;
  }
  if (payload.action === "sync") {
    const previous = sessions.get(payload.session.id);
    let inferredReveal = false;
    if (previous) {
      inferredReveal = Object.keys(payload.session.results ?? {}).some(uuid => !previous.results?.[uuid]);
    }
    return openOrRefresh(payload.session, {
      sound: payload.sound ?? (inferredReveal ? "reveal" : null)
    });
  }
  if (payload.action === "close") {
    const app = applications.get(payload.sessionId);
    if (app) await app.close({ broadcast: false, clearSession: true, playSound: true });
    else sessions.delete(payload.sessionId);
  }
}

function checkbox(name, value, label, checked = true, disabled = false) {
  return `<label class="emi-config-check ${disabled ? "is-disabled" : ""}"><input type="checkbox" name="${name}" value="${value}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}><span>${label}</span></label>`;
}

function defaultParticipantFilters(available) {
  return {
    sources: PACKS.filter(pack => available.has(pack.id)).map(pack => pack.id),
    rarities: RARITIES,
    permanence: ["permanent", "consumable"],
    categories: CATEGORIES.filter(category => category !== "ammunition"),
    attunement: "any",
    weaponBase: "random",
    spellClass: "random",
    spellSchool: "random",
    characterClasses: [],
    allowedWeaponBases: [],
    preferredWeaponBases: [],
    allowedArmorTypes: [],
    recommendationProfile: null,
    smartPreset: false
  };
}

function setValues(value) {
  if (value instanceof Set) return [...value];
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.keys(value).filter(key => value[key]);
  return value ? [value] : [];
}

function actorClassProfile(actor) {
  const classItems = [...(actor?.items ?? [])].filter(item => item.type === "class");
  const classes = [...new Set(classItems.map(item => normalizeName(item.system?.identifier || item.name)).filter(Boolean))];
  const classLevels = classItems.reduce((sum, item) => sum + Number(item.system?.levels ?? 0), 0);
  const level = Number(actor?.system?.details?.level ?? classLevels ?? 1) || 1;
  const weaponProf = setValues(actor?.system?.traits?.weaponProf?.value).map(normalizeName);
  const armorProf = setValues(actor?.system?.traits?.armorProf?.value).map(normalizeName);
  const spellcasting = Boolean(actor?.system?.attributes?.spellcasting) || classes.some(cls => FULL_CASTERS.has(cls) || HALF_CASTERS.has(cls));
  const arcane = classes.some(cls => ["artificer", "bard", "sorcerer", "warlock", "wizard"].includes(cls));
  return { classes, level, weaponProf, armorProf, spellcasting, arcane };
}


function weaponIsProficient(weapon, proficiencies) {
  const subtype = normalizeName(weapon.subtype);
  const base = normalizeName(weapon.baseItem);
  const name = normalizeName(weapon.name);
  if (proficiencies.some(p => [base, name].includes(p))) return true;
  if (proficiencies.some(p => ["mar", "martial", "martial weapons"].includes(p)) && subtype.includes("martial")) return true;
  if (proficiencies.some(p => ["sim", "simple", "simple weapons"].includes(p)) && subtype.includes("simple")) return true;
  return false;
}

function armorTypesFromProficiencies(proficiencies, { highestOnly = false } = {}) {
  const result = new Set();
  for (const prof of proficiencies) {
    if (/light|lgt/.test(prof)) result.add("light");
    if (/medium|med/.test(prof)) result.add("medium");
    if (/heavy|hvy/.test(prof)) result.add("heavy");
    if (/shield|shl/.test(prof)) result.add("shield");
  }
  if (!highestOnly) return [...result];
  const best = result.has("heavy") ? "heavy" : result.has("medium") ? "medium" : result.has("light") ? "light" : null;
  return [best, result.has("shield") ? "shield" : null].filter(Boolean);
}

function weaponIsTwoHanded(weapon) {
  const properties = new Set((weapon?.properties ?? []).map(normalizeName));
  return properties.has("two") || properties.has("two-handed") || properties.has("hvy") || properties.has("heavy");
}

function preferredWeaponWeight(weapon, profile) {
  let weight = 1;
  const base = normalizeName(weapon?.baseItem);
  const name = normalizeName(weapon?.name);
  if (profile?.hasBladePact && weaponIsTwoHanded(weapon)) weight += 4;
  if (profile?.classes?.includes("druid") && (base === "quarterstaff" || name === "quarterstaff")) weight += 6;
  return weight;
}

function smartFiltersForActor(actor, available) {
  const profile = actorRecommendationProfile(actor);
  const weaponCategoryAllowed = !profile.pureWizardOrSorcerer && (!profile.classes.includes("warlock") || profile.hasBladePact || profile.classes.some(cls => cls !== "warlock"));
  const proficientWeapons = (catalogCache?.baseWeapons ?? [])
    .filter(weapon => weaponIsProficient(weapon, profile.weaponProf))
    .filter(weapon => weaponMatchesAbilityProfile(weapon, profile));
  const allowedWeaponBases = weaponCategoryAllowed ? proficientWeapons.map(weapon => weapon.uuid) : [];
  const preferredWeaponBases = proficientWeapons
    .filter(weapon => preferredWeaponWeight(weapon, profile) > 1)
    .map(weapon => weapon.uuid);
  const allowedArmorTypes = armorTypesFromProficiencies(profile.armorProf, { highestOnly: true });
  const categories = new Set(["potion", "ring", "wondrous"]);
  if (allowedWeaponBases.length) categories.add("weapon");
  // Ammunition remains opt-in even when the character is proficient with bows
  // or crossbows; it otherwise overwhelms the recommendation pool.
  if (allowedArmorTypes.some(type => ["light", "medium", "heavy"].includes(type))) categories.add("armor");
  if (allowedArmorTypes.includes("shield")) categories.add("shield");
  if (profile.spellcasting) categories.add("scroll");
  if (profile.arcane) { categories.add("staff"); categories.add("wand"); categories.add("rod"); }
  return {
    ...defaultParticipantFilters(available),
    rarities: rarityForLevel(profile.level),
    categories: [...categories],
    characterClasses: profile.classes,
    allowedWeaponBases,
    preferredWeaponBases,
    allowedArmorTypes,
    recommendationProfile: profile,
    smartPreset: true,
    spellClass: profile.classes.find(cls => SPELL_CLASSES.includes(cls)) ?? "random"
  };
}



async function previewRecommendedItems(actor, filters = null) {
  if (!actor) return ui.notifications.warn(i18n("EMI.Error.SelectActor"));
  const catalog = await buildCatalog();
  const available = new Set(catalog.availablePacks);
  const activeFilters = filters ?? smartFiltersForActor(actor, available);
  const profile = activeFilters.recommendationProfile ?? actorRecommendationProfile(actor);
  const manualFilters = { ...foundry.utils.deepClone(activeFilters), smartPreset: false };
  const candidates = filterCatalog(catalog.items, manualFilters)
    .map(item => ({ item, evaluation: recommendationEvaluation(item, activeFilters, profile) }))
    .filter(entry => entry.evaluation.eligible)
    .sort((a, b) => b.evaluation.score - a.evaluation.score || a.item.name.localeCompare(b.item.name));

  const rows = candidates.map(({ item, evaluation }) => {
    const reasons = [...evaluation.reasons, ...evaluation.warnings.map(text => i18nFormat("EMI.Recommendation.Caution", { reason: text }))];
    return `<article class="emi-recommendation-row">
      <img src="${escapeHtml(item.img)}" alt="">
      <div class="emi-recommendation-main">
        <div class="emi-recommendation-title"><b>${escapeHtml(item.name)}</b><span>${evaluation.score}</span></div>
        <small>${escapeHtml(displayRarityLabel(item, activeFilters))} · ${escapeHtml(categoryLabel(item.category))}</small>
        <p>${escapeHtml(reasons.join(" • ") || i18n("EMI.Recommendation.CompatiblePreset"))}</p>
      </div>
      <button type="button" data-emi-open-recommendation="${escapeHtml(item.uuid)}" title="${escapeHtml(i18n("EMI.Common.OpenItemSheet"))}"><i class="fa-solid fa-book-open"></i></button>
    </article>`;
  }).join("");

  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    classes: ["emi-recommendations-dialog"],
    window: { title: i18nFormat("EMI.Recommendation.DialogTitle", { name: actor.name }), resizable: true, minimizable: false },
    position: { width: Math.min(900, window.innerWidth - 80), height: Math.min(820, window.innerHeight - 100) },
    content: `<section class="emi-recommendations">
      <header>${i18nFormat("EMI.Recommendation.Count", { number: candidates.length })}<input type="search" placeholder="${escapeHtml(i18n("EMI.Recommendation.FilterItems"))}" data-emi-recommendation-search></header>
      <div class="emi-recommendation-list">${rows || `<p class="notes">${escapeHtml(i18n("EMI.Recommendation.NoMatches"))}</p>`}</div>
    </section>`,
    buttons: [{ action: "close", label: i18n("EMI.Common.Close"), default: true, callback: () => true }],
    rejectClose: false
  });
}

function participantFilterContent(filters, available, actorUuid = "") {
  const sourceHtml = PACKS.map(pack => checkbox("cfg-sources", pack.id, i18n(pack.labelKey), filters.sources.includes(pack.id), !available.has(pack.id))).join("");
  const rarityHtml = RARITIES.map(key => checkbox("cfg-rarities", key, rarityLabel(key), filters.rarities.includes(key))).join("");
  const categoryHtml = CATEGORIES.map(key => checkbox("cfg-categories", key, categoryLabel(key), filters.categories.includes(key))).join("");
  const permanenceHtml = checkbox("cfg-permanence", "permanent", i18n("EMI.Permanence.Permanent"), filters.permanence.includes("permanent")) + checkbox("cfg-permanence", "consumable", i18n("EMI.Permanence.Consumable"), filters.permanence.includes("consumable"));
  return `
    <div class="emi-config emi-single-player-config">
      <section class="emi-smart-preset">
        <div><b>${i18n("EMI.Filter.CharacterPreset")}</b><small>${i18n("EMI.Filter.CharacterPresetHint")}</small></div>
        <div class="emi-smart-actions"><button type="button" data-emi-smart-preset="${actorUuid}"><i class="fa-solid fa-wand-magic-sparkles"></i> ${i18n("EMI.Filter.AnalyzeCharacter")}</button><button type="button" data-emi-preview-recommendations="${actorUuid}"><i class="fa-solid fa-list-check"></i> ${i18n("EMI.Filter.PreviewRecommended")}</button></div>
      </section>
      <input type="hidden" name="cfg-character-classes" value='${escapeHtml(JSON.stringify(filters.characterClasses ?? []))}'>
      <input type="hidden" name="cfg-weapon-allowlist" value='${escapeHtml(JSON.stringify(filters.allowedWeaponBases ?? []))}'>
      <input type="hidden" name="cfg-weapon-preferences" value='${escapeHtml(JSON.stringify(filters.preferredWeaponBases ?? []))}'>
      <input type="hidden" name="cfg-armor-types" value='${escapeHtml(JSON.stringify(filters.allowedArmorTypes ?? []))}'>
      <input type="hidden" name="cfg-recommendation-profile" value='${escapeHtml(JSON.stringify(filters.recommendationProfile ?? null))}'>
      <input type="hidden" name="cfg-smart-preset" value="${filters.smartPreset ? "true" : "false"}">
      <p class="emi-smart-result" data-emi-smart-result>${filters.smartPreset ? i18n("EMI.Filter.CharacterPresetActive") : i18n("EMI.Filter.ManualActive")}</p>
      <fieldset><legend>${i18n("EMI.Filter.Sources")}</legend><div class="emi-config-grid cols-2">${sourceHtml}</div></fieldset>
      <fieldset><legend>${i18n("EMI.Filter.Rarity")}</legend><div class="emi-config-grid cols-3">${rarityHtml}</div></fieldset>
      <fieldset><legend>${i18n("EMI.Filter.Permanence")}</legend><div class="emi-config-grid cols-2">${permanenceHtml}</div></fieldset>
      <fieldset><legend>${i18n("EMI.Filter.Categories")}</legend><div class="emi-category-tools"><button type="button" data-emi-category-toggle="all">${i18n("EMI.Filter.SelectAll")}</button><button type="button" data-emi-category-toggle="none">${i18n("EMI.Filter.ClearAll")}</button></div><div class="emi-config-grid cols-3">${categoryHtml}</div></fieldset>
      <fieldset><legend>${i18n("EMI.Filter.WeaponFinalForm")}</legend><select name="cfg-weapon-base"><option value="random">${i18n("EMI.Filter.RandomCompatibleWeapon")}</option>${(catalogCache?.baseWeapons ?? []).map(w => `<option value="${w.uuid}" ${filters.weaponBase === w.uuid ? "selected" : ""}>${escapeHtml(w.name)}</option>`).join("")}</select><p class="notes">${i18n("EMI.Filter.WeaponChoiceHint")}</p></fieldset>
      <fieldset><legend>${i18n("EMI.Filter.ScrollFinalForm")}</legend><div class="emi-config-grid cols-2"><label>${i18n("EMI.Common.Class")}<select name="cfg-spell-class"><option value="random">${i18n("EMI.Filter.RandomClass")}</option>${SPELL_CLASSES.map(value => `<option value="${value}" ${filters.spellClass === value ? "selected" : ""}>${classLabel(value)}</option>`).join("")}</select></label><label>${i18n("EMI.Common.School")}<select name="cfg-spell-school"><option value="random">${i18n("EMI.Filter.RandomSchool")}</option>${SPELL_SCHOOLS.map(value => `<option value="${value}" ${filters.spellSchool === value ? "selected" : ""}>${schoolLabel(value)}</option>`).join("")}</select></label></div></fieldset>
      <fieldset><legend>${i18n("EMI.Common.Attunement")}</legend><select name="cfg-attunement"><option value="any" ${filters.attunement === "any" ? "selected" : ""}>${i18n("EMI.Attunement.Any")}</option><option value="required" ${filters.attunement === "required" ? "selected" : ""}>${i18n("EMI.Attunement.RequiresLower")}</option><option value="none" ${filters.attunement === "none" ? "selected" : ""}>${i18n("EMI.Attunement.NoneLower")}</option></select></fieldset>
    </div>`;
}

function readParticipantFilters(form) {
  const checked = name => [...form.querySelectorAll(`input[name='${name}']:checked`)].map(input => input.value);
  return {
    sources: checked("cfg-sources"),
    rarities: checked("cfg-rarities"),
    permanence: checked("cfg-permanence"),
    categories: checked("cfg-categories"),
    weaponBase: form.elements["cfg-weapon-base"].value,
    spellClass: form.elements["cfg-spell-class"].value,
    spellSchool: form.elements["cfg-spell-school"].value,
    attunement: form.elements["cfg-attunement"].value,
    characterClasses: JSON.parse(form.elements["cfg-character-classes"]?.value || "[]"),
    allowedWeaponBases: JSON.parse(form.elements["cfg-weapon-allowlist"]?.value || "[]"),
    preferredWeaponBases: JSON.parse(form.elements["cfg-weapon-preferences"]?.value || "[]"),
    allowedArmorTypes: JSON.parse(form.elements["cfg-armor-types"]?.value || "[]"),
    recommendationProfile: JSON.parse(form.elements["cfg-recommendation-profile"]?.value || "null"),
    smartPreset: form.elements["cfg-smart-preset"]?.value === "true"
  };
}

function validParticipantFilters(filters) {
  return Boolean(filters?.sources?.length && filters?.rarities?.length && filters?.permanence?.length && filters?.categories?.length);
}

async function waitForParticipantFilters({ title, filters, available, actorUuid = "" }) {
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    classes: ["emi-player-config-dialog"],
    window: { title, resizable: true, minimizable: false },
    position: { width: Math.min(820, window.innerWidth - 80), height: Math.min(820, window.innerHeight - 100) },
    content: participantFilterContent(foundry.utils.deepClone(filters), available, actorUuid),
    buttons: [
      { action: "apply", label: i18n("EMI.Common.Apply"), default: true, callback: (_event, button) => ({ mode: "one", filters: readParticipantFilters(button.form) }) },
      { action: "applyAll", label: i18n("EMI.Common.ApplyAll"), callback: (_event, button) => ({ mode: "all", filters: readParticipantFilters(button.form) }) },
      { action: "cancel", label: i18n("EMI.Common.Cancel"), callback: () => ({ cancelled: true }) }
    ],
    rejectClose: false
  });
}

async function applySessionFilters(session, tokenUuid, filters, { applyToAll = false } = {}) {
  if (!validParticipantFilters(filters)) throw new Error(i18n("EMI.Error.RequiredFilters"));
  const targets = applyToAll ? session.participants.map(participant => participant.tokenUuid) : [tokenUuid];
  const nextFilters = foundry.utils.deepClone(session.participantFilters ?? {});
  const nextPools = { ...(session.participantPools ?? {}) };
  for (const targetUuid of targets) {
    nextFilters[targetUuid] = foundry.utils.deepClone(filters);
    const pool = filterCatalog(catalogCache?.items ?? [], filters);
    if (!pool.length) {
      const participant = session.participants.find(entry => entry.tokenUuid === targetUuid);
      throw new Error(i18nFormat("EMI.Error.NoFilterMatch", { name: participant?.name ?? i18n("EMI.Common.ThisCharacter") }));
    }
    nextPools[targetUuid] = pool;
  }

  // Validate only participants that still need a first-stage result. Existing
  // revealed cards remain valid and the new filters govern future rerolls.
  const pending = session.participants.map(p => p.tokenUuid).filter(uuid => !session.results?.[uuid]);
  const blocked = unavailableUuids(session);
  if (!hasDistinctAssignment(pending, nextPools, blocked)) {
    throw new Error(i18n("EMI.Error.FiltersNotDistinct"));
  }
  session.participantFilters = nextFilters;
  session.participantPools = nextPools;
  session.recommendedPools ??= {};
  for (const targetUuid of targets) session.recommendedPools[targetUuid] = false;
  session.finalOverrides ??= {};
  for (const targetUuid of targets) delete session.finalOverrides[targetUuid];
}

async function applyRecommendedPoolsToSession(session, enabled) {
  if (!game.user.isGM || !session) return;
  const available = new Set(catalogCache?.availablePacks ?? []);
  const nextFilters = foundry.utils.deepClone(session.participantFilters ?? {});
  const nextPools = { ...(session.participantPools ?? {}) };
  const nextRecommended = { ...(session.recommendedPools ?? {}) };

  for (const participant of session.participants) {
    const actor = await fromUuid(participant.actorUuid);
    if (!actor) throw new Error(i18nFormat("EMI.Error.ActorForCharacterMissing", { name: participant.name }));
    const filters = enabled ? smartFiltersForActor(actor, available) : defaultParticipantFilters(available);
    const pool = filterCatalog(catalogCache?.items ?? [], filters);
    if (!pool.length) throw new Error(i18nFormat("EMI.Error.NoPoolMatch", { pool: enabled ? i18n("EMI.Common.Recommended") : i18n("EMI.Common.Broad"), name: participant.name }));
    nextFilters[participant.tokenUuid] = filters;
    nextPools[participant.tokenUuid] = pool;
    nextRecommended[participant.tokenUuid] = enabled;
  }

  const pending = session.participants.map(p => p.tokenUuid).filter(uuid => !session.results?.[uuid]);
  const blocked = unavailableUuids(session);
  if (!hasDistinctAssignment(pending, nextPools, blocked)) {
    throw new Error(i18n("EMI.Error.PoolsNotDistinct"));
  }

  session.participantFilters = nextFilters;
  session.participantPools = nextPools;
  session.recommendedPools = nextRecommended;
  session.finalOverrides = {};
  await syncSession(session);
  ui.notifications.info(enabled ? i18n("EMI.Notification.RecommendedApplied") : i18n("EMI.Notification.BroadApplied"));
}

async function openSessionParticipantConfiguration(sessionId, tokenUuid) {
  const session = sessions.get(sessionId);
  if (!game.user.isGM || !session) return;
  const participant = session.participants.find(entry => entry.tokenUuid === tokenUuid);
  if (!participant) return;
  const available = new Set(catalogCache?.availablePacks ?? []);
  const result = await waitForParticipantFilters({
    title: i18nFormat("EMI.Main.ConfigureCharacter", { name: participant.name }),
    filters: session.participantFilters[tokenUuid],
    available,
    actorUuid: participant.actorUuid
  });
  if (!result || result.cancelled) return;
  try {
    await applySessionFilters(session, tokenUuid, result.filters, { applyToAll: result.mode === "all" });
    await syncSession(session);
  } catch (error) {
    console.error(`${MODULE_ID} | Could not update participant configuration`, error);
    ui.notifications.error(error.message);
    return openSessionParticipantConfiguration(sessionId, tokenUuid);
  }
}

async function startDraw() {
  if (!game.user.isGM) return ui.notifications.warn(i18n("EMI.Error.GMStartOnly"));
  if (game.system.id !== "dnd5e") return ui.notifications.error(i18n("EMI.Error.Dnd5eOnly"));
  const selected = [...canvas.tokens.controlled];
  if (!selected.length) return ui.notifications.warn(i18n("EMI.Error.SelectParticipants"));
  if (selected.length > MAX_PARTICIPANTS) return ui.notifications.error(i18nFormat("EMI.Error.MaxParticipants", { number: MAX_PARTICIPANTS }));

  let catalog;
  try {
    ui.notifications.info(i18n("EMI.Notification.Indexing"));
    catalog = await buildCatalog();
  } catch (error) {
    console.error(`${MODULE_ID} | Catalog error`, error);
    return ui.notifications.error(error.message);
  }

  const useRecommendedPools = game.settings.get(MODULE_ID, SETTINGS.RECOMMENDED_BY_DEFAULT);
  const available = new Set(catalog.availablePacks);
  const participantFilters = {};
  const participantPools = {};
  const recommendedPools = {};
  for (const token of selected) {
    const filters = useRecommendedPools
      ? smartFiltersForActor(token.actor, available)
      : defaultParticipantFilters(available);
    const pool = filterCatalog(catalog.items, filters);
    if (!pool.length) return ui.notifications.error(i18nFormat("EMI.Error.NoDefaultPoolMatch", { name: token.name }));
    participantFilters[token.document.uuid] = filters;
    participantPools[token.document.uuid] = pool;
    recommendedPools[token.document.uuid] = useRecommendedPools;
  }

  const autoGrant = game.settings.get(MODULE_ID, SETTINGS.AUTO_GRANT);
  const postToChat = game.settings.get(MODULE_ID, SETTINGS.POST_TO_CHAT);

  const tokenUuids = selected.map(token => token.document.uuid);
  if (!hasDistinctAssignment(tokenUuids, participantPools)) {
    return ui.notifications.error(i18n("EMI.Error.IndividualFiltersNotDistinct"));
  }

  const windowOpensAt = Date.now() + START_SYNC_BUFFER_MS;
  const introEndsAt = windowOpensAt
    + CARD_SEQUENCE_DELAY_MS
    + ((selected.length - 1) * CARD_SEQUENCE_INTERVAL_MS)
    + INTRO_TAIL_MS;

  const session = {
    id: foundry.utils.randomID(),
    createdBy: game.user.id,
    windowOpensAt,
    introEndsAt,
    autoGrant: Boolean(autoGrant),
    postToChat: Boolean(postToChat),
    finalOverrides: {},
    rollPermissions: Object.fromEntries(selected.map(token => [token.document.uuid, false])),
    participantFilters,
    participantPools,
    recommendedPools,
    participants: selected.map(token => ({
      tokenUuid: token.document.uuid,
      actorUuid: token.actor.uuid,
      name: token.name,
      portrait: token.actor.img || token.document.texture.src
    })),
    usedUuids: [],
    reserved: {},
    results: {},
    revealing: [],
    summaryPosted: false,
    summaryPosting: false
  };

  game.socket.emit(SOCKET_NAME, { action: "start", session: sessionForSocket(session) });
  await openOrRefresh(session, { openingSound: true });
}

async function ensureLaunchMacro() {
  if (!game.user.isGM) return;
  const command = "await game.easyMagicItems.start();";
  let macro = game.macros.find(m => m.getFlag(MODULE_ID, "generatedMacro"));
  if (!macro) macro = game.macros.find(m => m.name === "EasyMagicItems" && String(m.command ?? "").trim() === command);
  const data = {
    name: "EasyMagicItems",
    type: "script",
    scope: "global",
    command,
    img: "icons/magic/symbols/runes-star-pentagon-blue.webp",
    flags: { [MODULE_ID]: { generatedMacro: true } }
  };
  try { macro ? await macro.update(data) : await Macro.create(data); }
  catch (error) { console.error(`${MODULE_ID} | Macro creation failed`, error); }
}

document.addEventListener("click", async event => {
  const openRecommendation = event.target.closest?.("[data-emi-open-recommendation]");
  if (openRecommendation) {
    const item = await fromUuid(openRecommendation.dataset.emiOpenRecommendation);
    if (item?.sheet) item.sheet.render(true);
    return;
  }
  const previewButton = event.target.closest?.("[data-emi-preview-recommendations]");
  if (previewButton) {
    const actor = await fromUuid(previewButton.dataset.emiPreviewRecommendations);
    const form = previewButton.closest("form");
    if (!actor || !form) return ui.notifications.warn(i18n("EMI.Error.AnalysisFailed"));
    let filters = readParticipantFilters(form);
    if (!filters.smartPreset || !filters.recommendationProfile) {
      const available = new Set(catalogCache?.availablePacks ?? []);
      filters = smartFiltersForActor(actor, available);
    }
    await previewRecommendedItems(actor, filters);
    return;
  }
  const smartButton = event.target.closest?.("[data-emi-smart-preset]");
  if (smartButton) {
    const actor = await fromUuid(smartButton.dataset.emiSmartPreset);
    const form = smartButton.closest("form");
    if (!actor || !form) return ui.notifications.warn(i18n("EMI.Error.AnalysisFailed"));
    const available = new Set(catalogCache?.availablePacks ?? []);
    const preset = smartFiltersForActor(actor, available);
    const setChecks = (name, values) => form.querySelectorAll(`input[name='${name}']`).forEach(input => { input.checked = values.includes(input.value); });
    setChecks("cfg-sources", preset.sources); setChecks("cfg-rarities", preset.rarities); setChecks("cfg-permanence", preset.permanence); setChecks("cfg-categories", preset.categories);
    form.elements["cfg-weapon-base"].value = "random";
    form.elements["cfg-spell-class"].value = preset.spellClass;
    form.elements["cfg-spell-school"].value = "random";
    form.elements["cfg-attunement"].value = "any";
    form.elements["cfg-character-classes"].value = JSON.stringify(preset.characterClasses);
    form.elements["cfg-weapon-allowlist"].value = JSON.stringify(preset.allowedWeaponBases);
    form.elements["cfg-weapon-preferences"].value = JSON.stringify(preset.preferredWeaponBases ?? []);
    form.elements["cfg-armor-types"].value = JSON.stringify(preset.allowedArmorTypes);
    form.elements["cfg-recommendation-profile"].value = JSON.stringify(preset.recommendationProfile);
    form.elements["cfg-smart-preset"].value = "true";
    const result = form.querySelector("[data-emi-smart-result]");
    if (result) result.textContent = i18nFormat("EMI.Filter.PresetResult", { level: actorClassProfile(actor).level, classes: preset.characterClasses.map(classLabel).join(", ") || i18n("EMI.Filter.NoClassDetected"), number: preset.allowedWeaponBases.length });
    ui.notifications.info(i18nFormat("EMI.Notification.ConfigurationSuggested", { name: actor.name }));
    return;
  }
  const categoryButton = event.target.closest?.("[data-emi-category-toggle]");
  if (categoryButton) {
    const checked = categoryButton.dataset.emiCategoryToggle === "all";
    categoryButton.closest("fieldset")?.querySelectorAll("input[type='checkbox']")?.forEach(input => { if (!input.disabled) input.checked = checked; });
    return;
  }
});


document.addEventListener("input", event => {
  const search = event.target.closest?.("[data-emi-recommendation-search]");
  if (!search) return;
  const term = normalizeName(search.value);
  search.closest(".emi-recommendations")?.querySelectorAll(".emi-recommendation-row").forEach(row => {
    row.hidden = Boolean(term) && !normalizeName(row.textContent).includes(term);
  });
});


function settingsToggleCard({ name, label, hint, enabled, icon, scope = "world", extraClass = "", overrideLabel = "" }) {
  const checked = enabled ? "checked" : "";
  const scopeLabel = scope === "client" ? i18n("EMI.Settings.ScopeDevice") : i18n("EMI.Settings.ScopeWorld");
  const scopeIcon = scope === "client" ? "fa-display" : "fa-globe";
  return `<label class="emi-settings-card ${extraClass}" data-emi-setting-card="${name}">
    <span class="emi-settings-card-icon"><i class="fas ${icon}" aria-hidden="true"></i></span>
    <span class="emi-settings-card-copy">
      <span class="emi-settings-card-title"><b>${label}</b><span class="emi-settings-scope"><i class="fas ${scopeIcon}" aria-hidden="true"></i>${scopeLabel}</span></span>
      <small>${hint}</small>
    </span>
    <input class="emi-settings-switch" type="checkbox" name="${name}" ${checked}>
    ${overrideLabel ? `<span class="emi-settings-override-label">${overrideLabel}</span>` : ""}
  </label>`;
}

function buildModuleConfigurationMarkup(values) {
  return `<section class="emi-settings-shell">
    <header class="emi-settings-header">
      <div class="emi-settings-mark"><i class="fas fa-gem" aria-hidden="true"></i></div>
      <div class="emi-settings-heading">
        <span class="emi-settings-kicker">${i18n("EMI.Settings.HeaderKicker")}</span>
        <h1>${i18n("EMI.Settings.HeaderTitle")}</h1>
        <p>${i18n("EMI.Settings.HeaderSubtitle")}</p>
      </div>
      <button type="button" class="emi-settings-restore" data-emi-restore-defaults title="${i18n("EMI.Settings.RestoreDefaultsHint")}">
        <i class="fas fa-rotate-left" aria-hidden="true"></i><span>${i18n("EMI.Settings.RestoreDefaults")}</span>
      </button>
    </header>

    <nav class="emi-settings-tabs" aria-label="${i18n("EMI.Settings.TabsLabel")}">
      <button type="button" class="active" data-emi-settings-tab="draw" aria-selected="true"><i class="fas fa-wand-magic-sparkles" aria-hidden="true"></i><span>${i18n("EMI.Settings.TabDraw")}</span></button>
      <button type="button" data-emi-settings-tab="delivery" aria-selected="false"><i class="fas fa-gift" aria-hidden="true"></i><span>${i18n("EMI.Settings.TabDelivery")}</span></button>
      <button type="button" data-emi-settings-tab="cinematic" aria-selected="false"><i class="fas fa-music" aria-hidden="true"></i><span>${i18n("EMI.Settings.TabCinematic")}</span></button>
    </nav>

    <div class="emi-settings-panels">
      <section class="emi-settings-panel active" data-emi-settings-panel="draw">
        <div class="emi-settings-section-heading">
          <div><span>${i18n("EMI.Settings.TabDraw")}</span><h2>${i18n("EMI.Settings.DrawTitle")}</h2><p>${i18n("EMI.Settings.DrawHint")}</p></div>
          <i class="fas fa-layer-group" aria-hidden="true"></i>
        </div>
        <div class="emi-settings-grid emi-settings-grid-single">
          ${settingsToggleCard({
            name: "recommended-default",
            label: i18n("EMI.Settings.RecommendedDefault"),
            hint: i18n("EMI.Settings.RecommendedDefaultHint"),
            enabled: values.recommendedByDefault,
            icon: "fa-user-check",
            scope: "world"
          })}
        </div>
        <div class="emi-settings-note"><i class="fas fa-circle-info" aria-hidden="true"></i><span>${i18n("EMI.Settings.DrawNote")}</span></div>
      </section>

      <section class="emi-settings-panel" data-emi-settings-panel="delivery">
        <div class="emi-settings-section-heading">
          <div><span>${i18n("EMI.Settings.TabDelivery")}</span><h2>${i18n("EMI.Settings.DeliveryTitle")}</h2><p>${i18n("EMI.Settings.DeliveryHint")}</p></div>
          <i class="fas fa-box-open" aria-hidden="true"></i>
        </div>
        <div class="emi-settings-grid emi-settings-grid-two">
          ${settingsToggleCard({
            name: "auto-grant",
            label: i18n("EMI.Settings.AutoGrant"),
            hint: i18n("EMI.Settings.AutoGrantHint"),
            enabled: values.autoGrant,
            icon: "fa-hand-holding-heart",
            scope: "world"
          })}
          ${settingsToggleCard({
            name: "post-to-chat",
            label: i18n("EMI.Settings.PostChat"),
            hint: i18n("EMI.Settings.PostChatHint"),
            enabled: values.postToChat,
            icon: "fa-comments",
            scope: "world"
          })}
        </div>
      </section>

      <section class="emi-settings-panel" data-emi-settings-panel="cinematic">
        <div class="emi-settings-section-heading">
          <div><span>${i18n("EMI.Settings.TabCinematic")}</span><h2>${i18n("EMI.Settings.CinematicTitle")}</h2><p>${i18n("EMI.Settings.CinematicHint")}</p></div>
          <i class="fas fa-wave-square" aria-hidden="true"></i>
        </div>
        <div class="emi-settings-grid emi-settings-grid-two">
          ${settingsToggleCard({
            name: "sound-enabled",
            label: i18n("EMI.Settings.SoundEnabled"),
            hint: i18n("EMI.Settings.SoundHint"),
            enabled: values.soundEnabled,
            icon: "fa-volume-high",
            scope: "client"
          })}
          ${settingsToggleCard({
            name: "opening-theme-enabled",
            label: i18n("EMI.Settings.OpeningThemeEnabled"),
            hint: i18n("EMI.Settings.OpeningThemeHint"),
            enabled: values.openingThemeEnabled,
            icon: "fa-compact-disc",
            scope: "client",
            extraClass: "emi-settings-opening-theme",
            overrideLabel: i18n("EMI.Settings.MasterAudioOff")
          })}
        </div>
        <div class="emi-settings-note emi-settings-audio-note"><i class="fas fa-headphones" aria-hidden="true"></i><span>${i18n("EMI.Settings.CinematicNote")}</span></div>
      </section>
    </div>
  </section>`;
}

function setupModuleConfigurationInteractions(root) {
  const shell = root?.querySelector?.(".emi-settings-shell")
    ?? (root?.matches?.(".emi-settings-shell") ? root : null);
  if (!shell || shell.dataset.emiSettingsReady === "true") return;
  shell.dataset.emiSettingsReady = "true";

  const tabButtons = [...shell.querySelectorAll("[data-emi-settings-tab]")];
  const panels = [...shell.querySelectorAll("[data-emi-settings-panel]")];
  const activateTab = tabId => {
    for (const button of tabButtons) {
      const active = button.dataset.emiSettingsTab === tabId;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    }
    for (const panel of panels) panel.classList.toggle("active", panel.dataset.emiSettingsPanel === tabId);
  };
  for (const button of tabButtons) button.addEventListener("click", () => activateTab(button.dataset.emiSettingsTab));

  const soundMaster = shell.querySelector('input[name="sound-enabled"]');
  const openingCard = shell.querySelector('[data-emi-setting-card="opening-theme-enabled"]');
  const audioNote = shell.querySelector(".emi-settings-audio-note");
  const syncAudioState = () => {
    const masterEnabled = Boolean(soundMaster?.checked);
    openingCard?.classList.toggle("is-overridden", !masterEnabled);
    audioNote?.classList.toggle("is-warning", !masterEnabled);
  };
  soundMaster?.addEventListener("change", syncAudioState);
  syncAudioState();

  shell.querySelector("[data-emi-restore-defaults]")?.addEventListener("click", () => {
    for (const input of shell.querySelectorAll('input[type="checkbox"]')) {
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    activateTab("draw");
  });
}

async function openModuleConfiguration() {
  if (!game.user.isGM) return ui.notifications.warn(i18n("EMI.Error.GMSettingsOnly"));

  const values = {
    autoGrant: game.settings.get(MODULE_ID, SETTINGS.AUTO_GRANT),
    postToChat: game.settings.get(MODULE_ID, SETTINGS.POST_TO_CHAT),
    recommendedByDefault: game.settings.get(MODULE_ID, SETTINGS.RECOMMENDED_BY_DEFAULT),
    soundEnabled: game.settings.get(MODULE_ID, SETTINGS.SOUND_ENABLED),
    openingThemeEnabled: game.settings.get(MODULE_ID, SETTINGS.OPENING_THEME_ENABLED)
  };

  const DialogV2 = foundry?.applications?.api?.DialogV2;
  if (!DialogV2?.wait) {
    ui.notifications.error(i18n("EMI.Error.DialogUnavailable"));
    return false;
  }

  let dialogHookId = null;
  let applicationHookId = null;
  const attach = (_app, element) => {
    const root = element?.[0] ?? element;
    if (!root?.querySelector?.(".emi-settings-shell")) return;
    setupModuleConfigurationInteractions(root);
    if (dialogHookId !== null) Hooks.off("renderDialogV2", dialogHookId);
    if (applicationHookId !== null) Hooks.off("renderApplicationV2", applicationHookId);
  };
  dialogHookId = Hooks.on("renderDialogV2", attach);
  applicationHookId = Hooks.on("renderApplicationV2", attach);

  try {
    return await DialogV2.wait({
      classes: ["emi-module-settings-dialog"],
      window: {
        title: i18n("EMI.Settings.Title"),
        icon: "fas fa-gem",
        resizable: true,
        minimizable: false
      },
      position: { width: Math.min(780, Math.max(460, window.innerWidth - 72)) },
      content: buildModuleConfigurationMarkup(values),
      buttons: [
        { action: "cancel", label: i18n("EMI.Common.Cancel"), callback: () => false },
        {
          action: "save",
          label: i18n("EMI.Settings.Save"),
          icon: "fas fa-floppy-disk",
          default: true,
          callback: async (_event, button) => {
            const form = button.form;
            await game.settings.set(MODULE_ID, SETTINGS.AUTO_GRANT, Boolean(form.querySelector("input[name='auto-grant']:checked")));
            await game.settings.set(MODULE_ID, SETTINGS.POST_TO_CHAT, Boolean(form.querySelector("input[name='post-to-chat']:checked")));
            await game.settings.set(MODULE_ID, SETTINGS.RECOMMENDED_BY_DEFAULT, Boolean(form.querySelector("input[name='recommended-default']:checked")));
            await game.settings.set(MODULE_ID, SETTINGS.SOUND_ENABLED, Boolean(form.querySelector("input[name='sound-enabled']:checked")));
            await game.settings.set(MODULE_ID, SETTINGS.OPENING_THEME_ENABLED, Boolean(form.querySelector("input[name='opening-theme-enabled']:checked")));
            ui.notifications.info(i18n("EMI.Notification.SettingsSaved"));
            return true;
          }
        }
      ],
      rejectClose: false
    });
  } finally {
    if (dialogHookId !== null) Hooks.off("renderDialogV2", dialogHookId);
    if (applicationHookId !== null) Hooks.off("renderApplicationV2", applicationHookId);
  }
}

async function resetModuleSettings() {
  if (!game.user.isGM) return ui.notifications.warn(i18n("EMI.Error.GMRestoreOnly"));
  await game.settings.set(MODULE_ID, SETTINGS.AUTO_GRANT, true);
  await game.settings.set(MODULE_ID, SETTINGS.POST_TO_CHAT, true);
  await game.settings.set(MODULE_ID, SETTINGS.RECOMMENDED_BY_DEFAULT, true);
  await game.settings.set(MODULE_ID, SETTINGS.SOUND_ENABLED, true);
  await game.settings.set(MODULE_ID, SETTINGS.OPENING_THEME_ENABLED, true);
  ui.notifications.info(i18n("EMI.Notification.SettingsRestored"));
  return true;
}


function applyEasyMagicItemsChatBranding(message, html) {
  if (!message?.flags?.[MODULE_ID]?.summary) return;

  const initial = html instanceof HTMLElement ? html : (html?.[0] ?? html);
  const iconPath = "icons/svg/chest.svg";

  const apply = () => {
    let root = initial;
    if (!root?.querySelector) return;
    root = root.matches?.(".chat-message") ? root : (root.closest?.(".chat-message") ?? root);
    root.classList.add("emi-branded-chat-message");

    const candidates = [...root.querySelectorAll(
      "img.message-avatar, img.avatar, .message-header img, .message-sender img, .message-metadata img"
    )];
    let avatar = candidates.find(image => !image.classList.contains("emi-chat-avatar"));

    if (avatar) {
      avatar.src = iconPath;
      avatar.alt = "EasyMagicItems";
      avatar.classList.add("emi-chat-avatar");
      candidates.filter(image => image !== avatar).forEach(image => image.remove());
      return;
    }

    avatar = root.querySelector(".emi-chat-avatar");
    if (avatar) return;

    const header = root.querySelector(".message-header") ?? root;
    const injected = document.createElement("img");
    injected.src = iconPath;
    injected.alt = "EasyMagicItems";
    injected.className = "emi-chat-avatar emi-chat-avatar-injected";
    header.prepend(injected);
  };

  apply();
  window.setTimeout(apply, 0);
}

Hooks.on("renderChatMessageHTML", applyEasyMagicItemsChatBranding);

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTINGS.AUTO_GRANT, {
    name: "EMI.Settings.RegisterAutoGrant",
    hint: "EMI.Settings.RegisterAutoGrantHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, SETTINGS.POST_TO_CHAT, {
    name: "EMI.Settings.PostChat",
    hint: "EMI.Settings.RegisterPostChatHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, SETTINGS.RECOMMENDED_BY_DEFAULT, {
    name: "EMI.Settings.RecommendedDefault",
    hint: "EMI.Settings.RegisterRecommendedHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, SETTINGS.SOUND_ENABLED, {
    name: "EMI.Settings.SoundEnabled",
    hint: "EMI.Settings.RegisterSoundHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, SETTINGS.OPENING_THEME_ENABLED, {
    name: "EMI.Settings.OpeningThemeEnabled",
    hint: "EMI.Settings.RegisterOpeningThemeHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
});

Hooks.on("createCompendium", invalidateCatalog);
Hooks.on("deleteCompendium", invalidateCatalog);
Hooks.on("updateCompendium", invalidateCatalog);
Hooks.on("createItem", document => { if (!document?.parent) invalidateCatalog(); });
Hooks.on("updateItem", document => { if (!document?.parent) invalidateCatalog(); });
Hooks.on("deleteItem", document => { if (!document?.parent) invalidateCatalog(); });

Hooks.once("ready", async () => {
  game.socket.on(SOCKET_NAME, onSocket);
  const module = game.modules.get(MODULE_ID);
  const api = {
    version: module?.version ?? "1.1.0-test2",
    start: startDraw,
    open: startDraw,
    openConfiguration: openModuleConfiguration,
    openConfig: openModuleConfiguration,
    configure: openModuleConfiguration,
    resetSettings: resetModuleSettings,
    restoreDefaults: resetModuleSettings,
    rebuildCatalog: async () => buildCatalog({ force: true }),
    invalidateCatalog,
    getCatalog: async () => (await buildCatalog()).items,
    previewRecommendations: async actor => previewRecommendedItems(actor ?? canvas?.tokens?.controlled?.[0]?.actor)
  };
  game.easyMagicItems = api;
  if (module) module.api = api;
  await ensureLaunchMacro();
  Hooks.callAll("easyMagicItemsReady", api);
});
