(async () => {
  const MODULE_ID = "easy-magic-items";
  const rows = [];
  const add = (status, test, detail = "") => rows.push({ status, test, detail });
  const pass = (test, detail = "") => add("PASS", test, detail);
  const warn = (test, detail = "") => add("WARN", test, detail);
  const fail = (test, detail = "") => add("FAIL", test, detail);
  const esc = value => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  try {
    const module = game.modules.get(MODULE_ID);
    const api = module?.api ?? game.easyMagicItems;
    if (!module?.active || !api) {
      fail("EasyMagicItems API", "Module is not active or its API is unavailable.");
    } else {
      pass("EasyMagicItems API", `v${module.version}`);
    }

    const systemVersion = game.system.version;
    const foundryVersion = game.version;
    pass("Environment", `Foundry ${foundryVersion} · D&D5e ${systemVersion}`);

    const dnd6 = foundry.utils.isNewerVersion(systemVersion, "5.99.99");
    if (dnd6) pass("D&D5e 6+ detected", systemVersion);
    else warn("D&D5e 6+ detected", `Current system is ${systemVersion}; 6+ specific checks will be informational.`);

    const catalog = api?.rebuildCatalog ? await api.rebuildCatalog() : null;
    if (!catalog?.items?.length) fail("Catalog rebuild", "No indexed magic items were returned.");
    else pass("Catalog rebuild", `${catalog.items.length} indexed entries · ${catalog.baseItems?.length ?? 0} base forms`);

    const templates = catalog?.items?.filter(item => item.materializationMode === "template") ?? [];
    if (templates.length) pass("Template discovery", `${templates.length} setup templates detected`);
    else fail("Template discovery", "No setup enchantment templates detected.");

    const resolutionItems = catalog?.items?.filter(item => item.resolutionRequired) ?? [];
    const unsupportedResolution = resolutionItems.filter(item => item.resolutionUnsupported);
    if (resolutionItems.length) pass("Resolution gate catalog", `${resolutionItems.length} entries require resolution before delivery · ${unsupportedResolution.length} intentionally excluded until supported`);
    else fail("Resolution gate catalog", "No resolution-required entries were detected.");

    const byName = (name, packId = null) => catalog?.items?.find(item => item.name === name && (!packId || item.packId === packId));
    const checkResolver = (name, kind, packId = null) => {
      const item = byName(name, packId);
      if (!item) return fail(`Resolver: ${name}`, "Not found in the indexed catalog.");
      const actual = item.resolutionSpec?.kind ?? "none";
      if (item.resolutionRequired && actual === kind) pass(`Resolver: ${name}`, `${actual}${packId ? ` · ${packId}` : ""}`);
      else fail(`Resolver: ${name}`, `expected ${kind}; got ${actual}; required=${Boolean(item.resolutionRequired)}`);
    };

    checkResolver("Armor of Resistance", "profile-table", "dnd5e.equipment24");
    checkResolver("Ring of Resistance", "profile-table", "dnd5e.equipment24");
    checkResolver("Potion of Resistance", "effect-table", "dnd5e.equipment24");
    checkResolver("Carpet of Flying", "activity-table", "dnd5e.equipment24");
    checkResolver("Manual of Golems", "activity-table", "dnd5e.equipment24");
    checkResolver("Necklace of Prayer Beads", "prayer-beads", "dnd5e.equipment24");
    checkResolver("Robe of Useful Items", "robe-patches", "dnd5e.equipment24");
    checkResolver("Bag of Beans", "initial-quantity", "dnd5e.equipment24");
    checkResolver("Deck of Illusions", "initial-quantity", "dnd5e.equipment24");

    const legacyResistance = resolutionItems.filter(item => item.packId === "dnd5e.items" && item.resolutionSpec?.kind === "legacy-resistance");
    if (legacyResistance.length >= 12) pass("Legacy Armor of Resistance", `${legacyResistance.length} pre-formed SRD armors are routed through resistance resolution.`);
    else warn("Legacy Armor of Resistance", `${legacyResistance.length} legacy variants detected; expected 12 when the full SRD pack is installed.`);

    const spellStoring = resolutionItems.filter(item => item.identifier === "ring-of-spell-storing");
    if (spellStoring.length && spellStoring.every(item => item.resolutionUnsupported)) {
      pass("Unresolved stored-spell guard", `${spellStoring.length} Ring of Spell Storing source(s) are excluded rather than delivered without their found contents.`);
    } else warn("Unresolved stored-spell guard", "Ring of Spell Storing was not detected or is not guarded in this content set.");
    const checkProfiles = (name, expected, materializing = null) => {
      const item = byName(name);
      if (!item) return fail(name, "Not found in the indexed catalog.");
      const count = item.profiles?.length ?? 0;
      const materializingCount = item.profiles?.filter(profile => profile.materializesBase !== false).length ?? 0;
      const okay = count === expected && (materializing === null || materializingCount === materializing);
      const detail = `${count} profiles · ${materializingCount} materializing`;
      return okay ? pass(name, detail) : fail(name, `${detail}; expected ${expected}${materializing === null ? "" : ` / ${materializing}`}.`);
    };

    checkProfiles("Weapon, +1, +2, or +3", 3, 3);
    checkProfiles("Armor of Resistance", 10, 10);
    checkProfiles("Dragon Scale Mail", 10, 10);
    checkProfiles("Ammunition of Slaying", 14, 14);
    checkProfiles("Hammer of Thunderbolts", 2, 1);
    checkProfiles("Flame Tongue", 1, 1);

    const weaponPlus = byName("Weapon, +1, +2, or +3");
    const weaponRarities = (weaponPlus?.profiles ?? []).map(profile => profile.rarity).filter(Boolean).sort().join(", ");
    if (/uncommon/.test(weaponRarities) && /rare/.test(weaponRarities) && /veryRare/.test(weaponRarities)) {
      pass("Variant rarities", weaponRarities);
    } else fail("Variant rarities", weaponRarities || "Expected +1/+2/+3 rarity metadata was not found.");

    const fixedWeapon = byName("Dagger of Venom");
    if (fixedWeapon && fixedWeapon.materializationMode === "ready") pass("Fixed-form weapon", "Dagger of Venom is delivered directly.");
    else warn("Fixed-form weapon", fixedWeapon ? `Mode: ${fixedWeapon.materializationMode}` : "Dagger of Venom is not present in this installed content set.");

    try {
      const slayingTable = await fromUuid("Compendium.dnd5e.tables24.RollTable.dmgSlayingAmmuni");
      const ranges = [...(slayingTable?.results?.values?.() ?? [])].map(result => result.range).filter(range => Array.isArray(range));
      const widths = ranges.map(([lo, hi]) => Number(hi) - Number(lo) + 1);
      const coverage = widths.reduce((sum, width) => sum + width, 0);
      if (coverage === 100 && new Set(widths).size > 1) pass("Weighted Slaying table", `1d100 coverage preserved with non-uniform bands: ${[...new Set(widths)].sort((a,b)=>a-b).join(", ")}`);
      else fail("Weighted Slaying table", `Unexpected ranges/coverage (${coverage}).`);
    } catch (error) {
      warn("Weighted Slaying table", error?.message ?? String(error));
    }

    try {
      const ring = await fromUuid("Compendium.dnd5e.equipment24.Item.dmgRingOfResista");
      const table = await fromUuid("Compendium.dnd5e.tables24.RollTable.dmgRingOfResista");
      const effects = new Map([...(ring?.effects?.values?.() ?? [])].map(effect => [effect.id, effect.name]));
      let mismatches = 0;
      for (const result of [...(table?.results?.values?.() ?? [])]) {
        const description = String(result.description ?? "");
        const label = description.match(/\{([^}]*)\}/)?.[1] ?? "";
        const effectId = description.match(/\.ActiveEffect\.([A-Za-z0-9]+)/)?.[1] ?? null;
        const effectName = effects.get(effectId) ?? "";
        const labelType = label.match(/^(Acid|Cold|Fire|Force|Lightning|Necrotic|Poison|Psychic|Radiant|Thunder)/i)?.[1]?.toLowerCase();
        const effectType = effectName.match(/\((Acid|Cold|Fire|Force|Lightning|Necrotic|Poison|Psychic|Radiant|Thunder)\)/i)?.[1]?.toLowerCase();
        if (labelType && effectType && labelType !== effectType) mismatches += 1;
      }
      if (mismatches) pass("Official Ring table sanitizer needed", `${mismatches} label/UUID mismatch(es) detected in official content; EasyMagicItems will reconcile the full one-to-one variant set.`);
      else pass("Official Ring table integrity", "No label/UUID mismatch detected in this installed content version.");
    } catch (error) {
      warn("Official Ring table integrity", error?.message ?? String(error));
    }

    const spellLists = globalThis.dnd5e?.registry?.spellLists;
    if (spellLists?.forType) {
      if (globalThis.dnd5e?.registry?.ready) await globalThis.dnd5e.registry.ready;
      const counts = {};
      let phbCount = 0;
      for (const cls of ["bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "warlock", "wizard"]) {
        const list = spellLists.forType(`class:${cls}`);
        const uuids = [...(list?.uuids ?? [])];
        counts[cls] = uuids.length;
        phbCount += uuids.filter(uuid => String(uuid).startsWith("Compendium.dnd-players-handbook.")).length;
      }
      pass("Spell List Registry", Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(" · "));
      if (game.modules.get("dnd-players-handbook")?.active) {
        if (phbCount) pass("PHB spell registration", `${phbCount} class-list references point to the official PHB module.`);
        else fail("PHB spell registration", "PHB is active but no registered class-list UUIDs were detected.");
      } else warn("PHB spell registration", "Official PHB module is not active; SRD/other registered lists will be used.");
    } else warn("Spell List Registry", "Not exposed by this D&D5e version; legacy spell discovery will be used.");

    const item5e = globalThis.dnd5e?.documents?.Item5e;
    if (typeof item5e?.createScrollFromCompendiumSpell === "function") pass("Modern scroll helper", "createScrollFromCompendiumSpell is available.");
    else warn("Modern scroll helper", "Unavailable; EasyMagicItems will use createScrollFromSpell/manual fallback.");

    if (typeof item5e?.createScrollFromSpell === "function") pass("Scroll fallback helper", "createScrollFromSpell is available.");
    else warn("Scroll fallback helper", "System scroll helper unavailable.");

    if (dnd6) {
      const flame = byName("Flame Tongue");
      let template = null;
      try { if (flame?.uuid) template = await fromUuid(flame.uuid); } catch (_) {}
      const activity = template?.system?.activities?.get?.(flame?.setupActivityId)
        ?? [...(template?.system?.activities?.values?.() ?? [])].find(a => a.type === "enchant" && !a.enchant?.self);
      if (activity && typeof activity.canEnchant === "function" && typeof activity.applyEnchantment === "function") {
        pass("EnchantActivity API", "canEnchant + applyEnchantment available.");
      } else fail("EnchantActivity API", "Modern enchantment methods were not found on Flame Tongue.");

      const sourceEffect = template?.effects?.get?.(flame?.profiles?.[0]?.id);
      if (typeof sourceEffect?.system?.collectRiders === "function" && typeof foundry.documents?.modifyBatch === "function") {
        pass("Rider API", "collectRiders + modifyBatch available.");
      } else fail("Rider API", "D&D5e 6 rider materialization API is incomplete.");
    }
  } catch (error) {
    console.error(`${MODULE_ID} | D&D5e 6 probe failed`, error);
    fail("Probe execution", error?.stack ?? error?.message ?? String(error));
  }

  const failures = rows.filter(row => row.status === "FAIL").length;
  const warnings = rows.filter(row => row.status === "WARN").length;
  const summary = failures ? `${failures} failure(s), ${warnings} warning(s)` : `No failures · ${warnings} warning(s)`;
  console.group(`EasyMagicItems D&D5e 6 probe — ${summary}`);
  console.table(rows);
  console.groupEnd();

  const html = `<section class="standard-form"><p><b>${esc(summary)}</b></p><p>This probe is read-only. It rebuilds indexes and inspects system capabilities; it does not create or modify actor items.</p><div style="max-height:60vh;overflow:auto"><table><thead><tr><th>Status</th><th>Check</th><th>Detail</th></tr></thead><tbody>${rows.map(row => `<tr><td><b>${esc(row.status)}</b></td><td>${esc(row.test)}</td><td>${esc(row.detail)}</td></tr>`).join("")}</tbody></table></div><p class="notes">The same results were written to the browser console as a table.</p></section>`;
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (DialogV2) await DialogV2.wait({ window: { title: "EasyMagicItems — D&D5e 6 Probe" }, content: html, buttons: [{ action: "close", label: "Close", default: true, callback: () => true }], rejectClose: false });
  else ui.notifications.info(`EasyMagicItems probe: ${summary}. See console for details.`);

  return rows;
})();
