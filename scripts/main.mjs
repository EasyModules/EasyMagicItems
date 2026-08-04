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

function getProperties(entry) {
  const raw = getValue(entry, "system.properties", []);
  if (Array.isArray(raw)) return raw;
  if (raw instanceof Set) return [...raw];
  return [];
}

function categorize(entry) {
  const documentType = String(entry.type ?? "");
  const subtype = String(getValue(entry, "system.type.value", ""));
  const baseItem = String(getValue(entry, "system.type.baseItem", ""));
  if (documentType === "weapon") {
    // The "amm" weapon property means the weapon uses ammunition; it does not
    // mean that the document itself is ammunition.
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
    for (const change of effect?.changes ?? []) {
      changes.push({ key: String(change?.key ?? ""), mode: Number(change?.mode ?? 0), value: String(change?.value ?? "") });
    }
    for (const change of effect?.system?.changes ?? []) {
      changes.push({ key: String(change?.key ?? ""), mode: Number(change?.mode ?? 0), value: String(change?.value ?? "") });
    }
  }
  return changes;
}

function normalizeIndexEntry(entry, packInfo) {
  const rarity = String(getValue(entry, "system.rarity", ""));
  if (!rarity || !RARITIES.includes(rarity)) return null;

  const documentType = String(entry.type ?? "");
  const subtype = String(getValue(entry, "system.type.value", ""));
  const autoDestroy = Boolean(getValue(entry, "system.uses.autoDestroy", false));
  const consumable = documentType === "consumable" || autoDestroy;
  const attunement = String(getValue(entry, "system.attunement", ""));
  const category = categorize(entry);
  const id = entry._id ?? entry.id;
  if (!id) return null;

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
    rarityLabel: rarityLabel(rarity),
    category,
    categoryLabel: categoryLabel(category),
    consumable,
    requiresAttunement: attunement === "required",
    attunement,
    documentType,
    subtype,
    baseItem: String(getValue(entry, "system.type.baseItem", "")),
    properties: getProperties(entry),
    rules: String(getValue(entry, "system.source.rules", "")),
    description: String(getValue(entry, "system.description.value", "")),
    enchantmentTemplate: Array.isArray(entry.effects) && entry.effects.some(effect => effect?.type === "enchantment" || effect?.system?.type === "enchantment"),
    classRestrictions: extractClassRestrictions(String(getValue(entry, "system.description.value", ""))),
    spellcasterRestricted: requiresSpellcaster(String(getValue(entry, "system.description.value", ""))),
    effectChanges: flattenEffectChanges(entry.effects)
  };
}

async function buildCatalog({ force = false } = {}) {
  if (catalogCache && !force) return catalogCache;
  if (catalogBuildPromise && !force) return catalogBuildPromise;

  const build = async () => {
  const fields = [
    "name", "img", "type", "system.rarity", "system.attunement",
    "system.type.value", "system.type.baseItem", "system.properties",
    "system.uses.autoDestroy", "system.source.rules", "system.level",
    "system.school", "system.sourceClass", "system.classes", "system.source.classes",
    "system.description.value", "effects"
  ];

  const all = [];
  const baseWeapons = [];
  const spells = [];
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
      const normalized = normalizeIndexEntry(entry, packInfo);
      if (normalized) all.push(normalized);
      const rarity = String(getValue(entry, "system.rarity", ""));
      const baseItem = String(getValue(entry, "system.type.baseItem", ""));
      if (entry.type === "weapon" && !rarity && baseItem) {
        baseWeapons.push({
          id: entry._id ?? entry.id,
          uuid: `Compendium.${packInfo.id}.Item.${entry._id ?? entry.id}`,
          packId: packInfo.id,
          sourcePriority: packInfo.priority,
          name: String(entry.name ?? baseItem),
          normalizedName: normalizeName(entry.name),
          baseItem,
          subtype: String(getValue(entry, "system.type.value", "")),
          properties: getProperties(entry),
          img: String(entry.img ?? "icons/svg/sword.svg")
        });
      }
    }
  }

  // Discover official D&D5e spell packs dynamically instead of hard-coding one edition.
  for (const pack of game.packs) {
    if (pack.documentName !== "Item" || !String(pack.collection).startsWith("dnd5e.")) continue;
    let index;
    try { index = await pack.getIndex({ fields }); } catch (_error) { continue; }
    for (const entry of index) {
      if (entry.type !== "spell") continue;
      const rawClasses = getValue(entry, "system.sourceClass", getValue(entry, "system.classes", getValue(entry, "system.source.classes", [])));
      const classes = Array.isArray(rawClasses) ? rawClasses : rawClasses && typeof rawClasses === "object" ? Object.keys(rawClasses).filter(key => rawClasses[key]) : String(rawClasses ?? "").split(/[;,|]/);
      spells.push({
        id: entry._id ?? entry.id,
        uuid: `Compendium.${pack.collection}.Item.${entry._id ?? entry.id}`,
        name: String(entry.name ?? i18n("EMI.Common.Spell")),
        normalizedName: normalizeName(entry.name),
        level: Number(getValue(entry, "system.level", 0)),
        school: String(getValue(entry, "system.school", "")),
        classes: classes.map(value => normalizeName(value)).filter(Boolean),
        img: String(entry.img ?? "icons/svg/book.svg")
      });
    }
  }

  const dedupeByName = (entries, prefer = "sourcePriority") => {
    const map = new Map();
    for (const entry of entries) {
      const current = map.get(entry.normalizedName);
      if (!current || Number(entry[prefer] ?? 0) > Number(current[prefer] ?? 0)) map.set(entry.normalizedName, entry);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  };

  const uniqueAcrossAllSources = new Map();
  for (const item of all) {
    const current = uniqueAcrossAllSources.get(item.normalizedName);
    if (!current || item.sourcePriority > current.sourcePriority) uniqueAcrossAllSources.set(item.normalizedName, item);
  }

  if (!availablePacks.length) {
    throw new Error(i18n("EMI.Error.NoCompatiblePacks"));
  }
  if (!all.length) {
    throw new Error(i18n("EMI.Error.EmptyCatalog"));
  }

  catalogCache = {
    builtAt: Date.now(),
    availablePacks,
    items: all.sort((a, b) => a.name.localeCompare(b.name)),
    baseWeapons: dedupeByName(baseWeapons),
    spells: dedupeByName(spells, "level"),
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
    if (sources.size && !sources.has(item.packId)) return false;
    if (rarities.size && !rarities.has(item.rarity)) return false;
    if (categories.size && !categories.has(item.category)) return false;
    if (permanence.size) {
      const key = item.consumable ? "consumable" : "permanent";
      if (!permanence.has(key)) return false;
    }
    if (attunement === "required" && !item.requiresAttunement) return false;
    if (attunement === "none" && item.requiresAttunement) return false;
    if (filters.characterClasses?.length && item.classRestrictions?.length && !item.classRestrictions.some(cls => filters.characterClasses.includes(cls))) return false;
    if (item.category === "armor" && filters.allowedArmorTypes?.length && item.subtype && !filters.allowedArmorTypes.includes(item.subtype)) return false;
    if (item.category === "shield" && filters.allowedArmorTypes?.length && !filters.allowedArmorTypes.includes("shield")) return false;
    // Every magic-weapon result in EasyMagicItems represents an enchantment
    // awaiting a second roll. Exclude old, already-shaped SRD variants so a
    // selected Greataxe cannot first reveal a Longsword or a ready-made axe.
    if (item.category === "weapon" && !isWeaponTemplateEntry(item)) return false;
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

function reserveRandomItem(session, tokenUuid) {
  const candidates = viableCandidates(session, tokenUuid);
  const selected = randomChoice(candidates);
  if (!selected) return null;
  session.reserved ??= {};
  session.reserved[tokenUuid] = selected;
  return selected;
}

function parseScrollLevel(item) {
  const match = String(item?.name ?? "").match(/(?:level|,)?\s*(cantrip|[1-9](?:st|nd|rd|th)?)/i);
  if (!match) return null;
  return match[1].toLowerCase() === "cantrip" ? 0 : Number.parseInt(match[1], 10);
}

function getEnchantmentEffects(document) {
  return [...(document?.effects ?? [])].filter(effect => effect.type === "enchantment" || effect.system?.type === "enchantment");
}

function isWeaponTemplateDocument(document) {
  if (document?.type !== "weapon") return false;
  if (getEnchantmentEffects(document).length > 0) return true;

  // Some official D&D5e indexes/documents do not expose the enchantment type
  // consistently. Treat clearly generic weapon templates as two-stage items,
  // while leaving ordinary fixed-form magic weapons untouched.
  const baseItem = String(getValue(document, "system.type.baseItem", ""));
  const text = weaponCompatibilityText(document);
  if (!baseItem && /weapon\s*\((?:any|a |simple|martial|sword|bow|crossbow|melee|ranged)/i.test(text)) return true;
  if (/make magical items with templates|template item|apply the enchantment|drag your effect onto/i.test(text)) return true;
  return false;
}

/**
 * Index-safe version of the template test. Weapon results are intentionally
 * limited to enchantment templates: pre-materialized legacy variants such as
 * Older already-shaped variants would otherwise bypass the second roll and
 * appear alongside their modern generic enchantment templates.
 */
function isWeaponTemplateEntry(entry) {
  if (entry?.category !== "weapon" && entry?.documentType !== "weapon") return false;
  const baseItem = String(entry?.baseItem ?? "");
  const text = normalizeName(plainTextFromHtml(entry?.description ?? "").slice(0, 900));
  if (baseItem) return false;
  const templateCue = /make magical items with templates|template item|apply the enchantment|drag your effect onto/i.test(text);
  const form = text.match(/weapon\s*\(([^)]+)\)/i)?.[1] ?? "";
  const fixedSingleForm = form && !/(?:any|simple|martial| or |,|sword|axe|bow|crossbow|melee|ranged)/i.test(form);
  if (fixedSingleForm && !templateCue) return false;
  if (entry?.enchantmentTemplate) return true;
  if (/weapon\s*\((?:any|a |simple|martial|sword|axe|bow|crossbow|melee|ranged)/i.test(text)) return true;
  if (templateCue) return true;
  return false;
}

function plainTextFromHtml(html) {
  const element = document.createElement("div");
  element.innerHTML = String(html ?? "");
  return element.textContent ?? "";
}

function weaponCompatibilityText(source) {
  const html = source?.description ?? String(getValue(source, "system.description.value", ""));
  return normalizeName(plainTextFromHtml(html).slice(0, 900));
}

function compatibleBaseWeapons(templateDocument, baseWeapons, { fallback = true } = {}) {
  const text = weaponCompatibilityText(templateDocument);
  // Official 2024 templates often enumerate valid base weapons directly in
  // the opening "Weapon (...)" line. When at least two known weapon names are
  // present, treat that list as authoritative instead of relying on broad
  // family heuristics.
  const explicitlyNamed = baseWeapons.filter(weapon => {
    const name = normalizeName(weapon.name);
    const baseName = normalizeName(weapon.baseItem);
    return (name && text.includes(name)) || (baseName && baseName.length > 3 && text.includes(baseName));
  });
  if (explicitlyNamed.length >= 2) return explicitlyNamed;
  const allowed = baseWeapons.filter(weapon => {
    const name = normalizeName(weapon.name);
    const props = new Set(weapon.properties ?? []);
    if (/any sword|sword/.test(text) && !name.includes("sword") && !["rapier", "scimitar"].includes(weapon.baseItem)) return false;
    if (/bow/.test(text) && !name.includes("bow")) return false;
    if (/crossbow/.test(text) && !name.includes("crossbow")) return false;
    if (/melee weapon/.test(text) && ["simpleR", "martialR"].includes(weapon.subtype)) return false;
    if (/ranged weapon/.test(text) && !["simpleR", "martialR"].includes(weapon.subtype)) return false;
    if (/slashing/.test(text) && !props.has("slashing") && !["longsword","shortsword","greatsword","scimitar","glaive","halberd","greataxe","battleaxe","handaxe"].includes(weapon.baseItem)) return false;
    return true;
  });
  return allowed.length || !fallback ? allowed : baseWeapons;
}

function itemAllowsSelectedWeapon(item, selectedWeaponUuid) {
  if (!selectedWeaponUuid || selectedWeaponUuid === "random" || item.category !== "weapon") return true;
  const base = (catalogCache?.baseWeapons ?? []).find(weapon => weapon.uuid === selectedWeaponUuid);
  if (!base) return false;
  // A generic 2024 enchantment template is eligible only when the chosen base
  // weapon satisfies its official compatibility text.
  if (isWeaponTemplateEntry(item)) {
    // Resolve compatibility against the complete base-weapon catalog first.
    // Passing only the chosen weapon would hide explicit lists such as
    // “Battleaxe, Greataxe, or Halberd” and incorrectly accept Greatsword.
    return compatibleBaseWeapons(item, catalogCache?.baseWeapons ?? [], { fallback: false })
      .some(weapon => weapon.uuid === base.uuid);
  }
  return false;
}

function spellMatchesPreference(spell, preference, level) {
  if (spell.level !== level) return false;
  if (preference?.spellSchool && preference.spellSchool !== "random" && spell.school !== preference.spellSchool) return false;
  if (preference?.spellClass && preference.spellClass !== "random") {
    // Older official indexes do not always expose class lists. In that case,
    // keep the spell eligible rather than creating an empty pool.
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
        finalButtonLabel: result?.finalKind === "weapon" ? i18n("EMI.Main.RollWeaponType") : i18n("EMI.Main.RollSpell"),
        finalKindWeapon: result?.finalKind === "weapon",
        finalKindScroll: result?.finalKind === "scroll",
        weaponOptions: (result?.weaponOptions ?? []).map(option => ({ ...option, selected: finalPreference(session, participant.tokenUuid).weaponBase === option.value })),
        spellClassOptions: SPELL_CLASSES.map(value => ({ value, label: classLabel(value), selected: finalPreference(session, participant.tokenUuid).spellClass === value })),
        spellSchoolOptions: SPELL_SCHOOLS.map(value => ({ value, label: schoolLabel(value), selected: finalPreference(session, participant.tokenUuid).spellSchool === value })),
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

async function createItemForParticipant(session, tokenUuid, itemData, sourceUuid) {
  if (!session.autoGrant || !itemData) return null;
  const participant = session.participants.find(entry => entry.tokenUuid === tokenUuid);
  const actor = participant?.actorUuid ? await fromUuid(participant.actorUuid) : null;
  if (!actor || actor.documentName !== "Actor") throw new Error(i18n("EMI.Error.ActorLoad"));
  const data = foundry.utils.deepClone(itemData);
  delete data._id; delete data.folder; delete data.ownership; delete data._stats;
  data.flags = foundry.utils.mergeObject(data.flags ?? {}, { [MODULE_ID]: { grantedBySession: session.id, sourceUuid, participantTokenUuid: tokenUuid } }, { inplace: false });
  const [created] = await actor.createEmbeddedDocuments("Item", [data], { keepId: false });
  return created ?? null;
}

async function grantItemToParticipant(session, tokenUuid, sourceDocument) {
  return createItemForParticipant(session, tokenUuid, sourceDocument?.toObject(), sourceDocument?.uuid);
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

  const pendingWeapon = selected.category === "weapon" && (isWeaponTemplateEntry(selected) || isWeaponTemplateDocument(sourceDocument));
  const scrollLevel = selected.category === "scroll" ? parseScrollLevel(selected) : null;
  const pendingScroll = scrollLevel !== null && scrollLevel !== undefined;

  session.usedUuids ??= [];
  session.usedUuids.push(selected.uuid);
  delete session.reserved[tokenUuid];
  session.results ??= {};

  if (pendingWeapon || pendingScroll) {
    const compatible = pendingWeapon ? compatibleBaseWeapons(sourceDocument, catalogCache?.baseWeapons ?? []) : [];
    session.results[tokenUuid] = {
      uuid: selected.uuid, name: selected.name, img: selected.img, rarity: selected.rarity,
      rarityLabel: selected.rarityLabel, category: selected.category, categoryLabel: selected.categoryLabel,
      requiresAttunement: selected.requiresAttunement, packLabel: selected.packLabel,
      pendingFinal: true, finalKind: pendingWeapon ? "weapon" : "scroll", scrollLevel,
      weaponOptions: compatible.map(w => ({ value: w.uuid, label: w.name }))
    };
    return selected;
  }

  let granted = null; let grantFailed = false;
  try { granted = await grantItemToParticipant(session, tokenUuid, sourceDocument); }
  catch (error) { grantFailed = Boolean(session.autoGrant); console.error(`${MODULE_ID} | Inventory delivery failed`, error); }
  session.results[tokenUuid] = {
    uuid: selected.uuid, grantedUuid: granted?.uuid ?? null, grantFailed,
    name: selected.name, img: selected.img, rarity: selected.rarity, rarityLabel: selected.rarityLabel,
    category: selected.category, categoryLabel: selected.categoryLabel,
    requiresAttunement: selected.requiresAttunement, packLabel: selected.packLabel
  };
  return selected;
}

async function materializeWeapon(session, tokenUuid, result) {
  const template = await fromUuid(result.uuid);
  const allBaseWeapons = catalogCache?.baseWeapons ?? [];
  let compatible = compatibleBaseWeapons(template, allBaseWeapons);
  const preference = finalPreference(session, tokenUuid);
  if (preference.allowedWeaponBases?.length) compatible = compatible.filter(weapon => preference.allowedWeaponBases.includes(weapon.uuid));
  const explicitWeapon = preference.weaponBase && preference.weaponBase !== "random";
  let base = explicitWeapon
    ? allBaseWeapons.find(w => w.uuid === preference.weaponBase)
    : weightedChoice(compatible, weapon => {
        if (preference.preferredWeaponBases?.includes(weapon.uuid)) return 6;
        return preferredWeaponWeight(weapon, preference.recommendationProfile);
      });
  if (!base) throw new Error(explicitWeapon ? i18n("EMI.Error.SelectedWeaponNotFound") : i18n("EMI.Error.NoCompatibleBaseWeapon"));

  // A specific GM selection is authoritative. It was already used to filter
  // the first-stage pool, so never silently replace it with a random weapon.
  if (explicitWeapon && !itemAllowsSelectedWeapon({
    category: "weapon",
    enchantmentTemplate: true,
    baseItem: String(getValue(template, "system.type.baseItem", "")),
    description: String(getValue(template, "system.description.value", ""))
  }, base.uuid)) {
    throw new Error(i18nFormat("EMI.Error.WeaponIncompatible", { template: template.name, base: base.name }));
  }
  const baseDocument = await fromUuid(base.uuid);
  const data = baseDocument.toObject();
  delete data._id;

  // Copy rider activities and non-enchantment effects from the official template.
  const templateActivities = foundry.utils.deepClone(getValue(template, "system.activities", {}));
  const riderActivities = Object.fromEntries(Object.entries(templateActivities).filter(([, activity]) => activity.type !== "enchant"));
  data.system.activities = foundry.utils.mergeObject(data.system.activities ?? {}, riderActivities, { inplace: false, insertKeys: true, overwrite: true });
  const nonEnchantEffects = [...template.effects].filter(e => e.type !== "enchantment").map(e => { const d=e.toObject(); delete d._id; d.disabled=false; d.origin=template.uuid; return d; });
  data.effects = [...(data.effects ?? []), ...nonEnchantEffects];

  const created = await createItemForParticipant(session, tokenUuid, data, template.uuid);
  if (!created) {
    // Without inventory delivery there is no parent document on which Foundry can
    // safely materialize enchantments. Keep a readable final result and source link.
    return { uuid: template.uuid, grantedUuid: null, name: `${template.name} ${base.name}`, img: template.img || base.img };
  }
  try {
    const effectData = getEnchantmentEffects(template).map(effect => {
      const data = effect.toObject();
      delete data._id;
      data.disabled = false;
      data.origin = template.uuid;
      return data;
    });
    if (effectData.length) await created.createEmbeddedDocuments("ActiveEffect", effectData);
    return { uuid: template.uuid, grantedUuid: created.uuid, name: created.name, img: created.img };
  } catch (error) {
    try { await created.delete(); } catch (cleanupError) {
      console.warn(`${MODULE_ID} | Could not clean up a partially created weapon`, cleanupError);
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
  if (Item5e?.createScrollFromSpell) {
    // The system helper can display its own Create Scroll dialog. Suppress that
    // prompt for this automated workflow, and serialize calls as a defensive
    // fallback so rapid clicks can never stack system dialogs behind the draw UI.
    const createScroll = async () => Item5e.createScrollFromSpell(
      spellDocument,
      {},
      {
        dialog: false,
        level: result.scrollLevel
      }
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
    scrollData.system.description.value = `<h2>${escapeHtml(spellDocument.name)}</h2>${getValue(spellDocument, "system.description.value", "")}`;
  }
  const created = await createItemForParticipant(session, tokenUuid, scrollData, spellDocument.uuid);
  return { uuid: spellDocument.uuid, grantedUuid: created?.uuid ?? null, name: created?.name ?? scrollData.name ?? i18nFormat("EMI.Common.SpellScrollOf", { spell: spell.name }), img: created?.img ?? scrollData.img ?? spell.img };
}

async function finalizeTemplateResult(session, tokenUuid) {
  const result = session.results?.[tokenUuid];
  if (!result?.pendingFinal) return;
  const final = result.finalKind === "weapon" ? await materializeWeapon(session, tokenUuid, result) : await materializeScroll(session, tokenUuid, result);
  Object.assign(result, final, { pendingFinal: false, finalizedFromUuid: result.uuid, finalKind: null, weaponOptions: null, grantFailed: Boolean(session.autoGrant && !final.grantedUuid) });
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
  const reserved = reserveRandomItem(session, payload.tokenUuid);
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
        <small>${escapeHtml(rarityLabel(item.rarity))} · ${escapeHtml(categoryLabel(item.category))}</small>
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


async function openModuleConfiguration() {
  if (!game.user.isGM) return ui.notifications.warn(i18n("EMI.Error.GMSettingsOnly"));
  const autoGrant = game.settings.get(MODULE_ID, SETTINGS.AUTO_GRANT);
  const postToChat = game.settings.get(MODULE_ID, SETTINGS.POST_TO_CHAT);
  const recommendedByDefault = game.settings.get(MODULE_ID, SETTINGS.RECOMMENDED_BY_DEFAULT);
  const soundEnabled = game.settings.get(MODULE_ID, SETTINGS.SOUND_ENABLED);
  const openingThemeEnabledSetting = game.settings.get(MODULE_ID, SETTINGS.OPENING_THEME_ENABLED);
  const checked = value => value ? "checked" : "";
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    classes: ["emi-module-settings-dialog"],
    window: { title: i18n("EMI.Settings.Title"), resizable: false, minimizable: false },
    position: { width: Math.min(620, window.innerWidth - 60) },
    content: `<section class="emi-module-settings">
      <p>${i18n("EMI.Settings.Intro")}</p>
      <fieldset><legend>${i18n("EMI.Settings.ItemDelivery")}</legend>
        <label class="emi-setting-row"><input type="checkbox" name="auto-grant" ${checked(autoGrant)}><span><b>${i18n("EMI.Settings.AutoGrant")}</b><small>${i18n("EMI.Settings.AutoGrantHint")}</small></span></label>
        <label class="emi-setting-row"><input type="checkbox" name="post-to-chat" ${checked(postToChat)}><span><b>${i18n("EMI.Settings.PostChat")}</b><small>${i18n("EMI.Settings.PostChatHint")}</small></span></label>
      </fieldset>
      <fieldset><legend>${i18n("EMI.Settings.Sound")}</legend>
        <label class="emi-setting-row"><input type="checkbox" name="sound-enabled" ${checked(soundEnabled)}><span><b>${i18n("EMI.Settings.SoundEnabled")}</b><small>${i18n("EMI.Settings.SoundHint")}</small></span></label>
        <label class="emi-setting-row emi-setting-subrow"><input type="checkbox" name="opening-theme-enabled" ${checked(openingThemeEnabledSetting)}><span><b>${i18n("EMI.Settings.OpeningThemeEnabled")}</b><small>${i18n("EMI.Settings.OpeningThemeHint")}</small></span></label>
      </fieldset>
      <fieldset><legend>${i18n("EMI.Settings.DefaultPools")}</legend>
        <label class="emi-setting-row"><input type="checkbox" name="recommended-default" ${checked(recommendedByDefault)}><span><b>${i18n("EMI.Settings.RecommendedDefault")}</b><small>${i18n("EMI.Settings.RecommendedDefaultHint")}</small></span></label>
      </fieldset>
    </section>`,
    buttons: [
      { action: "save", label: i18n("EMI.Settings.Save"), default: true, callback: async (_event, button) => {
        const form = button.form;
        await game.settings.set(MODULE_ID, SETTINGS.AUTO_GRANT, Boolean(form.querySelector("input[name='auto-grant']:checked")));
        await game.settings.set(MODULE_ID, SETTINGS.POST_TO_CHAT, Boolean(form.querySelector("input[name='post-to-chat']:checked")));
        await game.settings.set(MODULE_ID, SETTINGS.RECOMMENDED_BY_DEFAULT, Boolean(form.querySelector("input[name='recommended-default']:checked")));
        await game.settings.set(MODULE_ID, SETTINGS.SOUND_ENABLED, Boolean(form.querySelector("input[name='sound-enabled']:checked")));
        await game.settings.set(MODULE_ID, SETTINGS.OPENING_THEME_ENABLED, Boolean(form.querySelector("input[name='opening-theme-enabled']:checked")));
        ui.notifications.info(i18n("EMI.Notification.SettingsSaved"));
        return true;
      }},
      { action: "cancel", label: i18n("EMI.Common.Cancel"), callback: () => false }
    ],
    rejectClose: false
  });
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
    version: module?.version ?? "1.0.1",
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
