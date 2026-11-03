// Golden tests for the pure three-way merge core (i18n.md §"The four cases").
// Keyed on THEIRS (live source) for which keys exist; OURS (translation) for
// values; BASE (lock) lags to give the merge information.

import { describe, expect, it } from "vitest";
import {
  conflictMarker,
  hasConflictMarkers,
  isTodo,
  type MergeReport,
  mergeCatalog,
  normalizeLegacy,
  reportHasPending,
  TODO_PREFIX,
} from "../../src/i18n/merge.js";

describe("mergeCatalog — the four cases", () => {
  it("new key → stays ABSENT (untranslated), reported as added", () => {
    const { merged, report } = mergeCatalog(
      {}, // BASE
      {}, // OURS (fr)
      { "page.P.heading.a1b2c3": "Shipments" }, // THEIRS
    );
    expect(merged).toEqual({});
    expect(report.added).toEqual(["page.P.heading.a1b2c3"]);
    expect(report.untranslated).toEqual(["page.P.heading.a1b2c3"]);
    expect(report.kept).toEqual([]);
  });

  it("deleted key → dropped from the locale, reported as dropped", () => {
    const { merged, report } = mergeCatalog(
      { "page.P.heading.old111": "Orders" }, // BASE
      { "page.P.heading.old111": "Commandes" }, // OURS
      {}, // THEIRS — key gone from source
    );
    expect(merged).toEqual({});
    expect(report.dropped).toEqual(["page.P.heading.old111"]);
  });

  it("an already-known untranslated key is not 'added' again (a settled tree is quiet)", () => {
    const k = "page.P.heading.a1b2c3";
    const { merged, report } = mergeCatalog({ [k]: "Shipments" }, {}, { [k]: "Shipments" });
    expect(merged).toEqual({});
    expect(report.added).toEqual([]);
    expect(report.untranslated).toEqual([k]);
    expect(reportHasPending(report)).toBe(false);
  });

  it("deleted key with --keepStale → parked in the stale sidecar, not in the file", () => {
    const { merged, stale, report } = mergeCatalog(
      { "page.P.heading.old111": "Orders" },
      { "page.P.heading.old111": "Commandes" },
      {},
      { keepStale: true },
    );
    expect(merged).toEqual({});
    expect(stale).toEqual({ "page.P.heading.old111": "Commandes" });
    expect(report.dropped).toEqual(["page.P.heading.old111"]);
  });

  it("unchanged + translated → keeps the human translation untouched", () => {
    const { merged, report } = mergeCatalog(
      { "page.P.heading.k1": "Orders" }, // BASE
      { "page.P.heading.k1": "Commandes" }, // OURS
      { "page.P.heading.k1": "Orders" }, // THEIRS — same source
    );
    expect(merged["page.P.heading.k1"]).toBe("Commandes");
    expect(report.kept).toEqual(["page.P.heading.k1"]);
    expect(report.added).toEqual([]);
  });

  it("source changed (hashed keys) → clean delete-old + new key left untranslated", () => {
    // Rephrasing re-hashes the key: old key vanishes from THEIRS, new key
    // appears.  No same-key conflict; the translator gets a fresh TODO.
    const { merged, report } = mergeCatalog(
      { "page.P.heading.old": "Orders" }, // BASE
      { "page.P.heading.old": "Commandes" }, // OURS (translated the old wording)
      { "page.P.heading.new": "Order management" }, // THEIRS (rephrased)
    );
    expect(merged).toEqual({});
    expect(report.added).toEqual(["page.P.heading.new"]);
    expect(report.dropped).toEqual(["page.P.heading.old"]);
  });

  it("source changed on a STABLE key over a translation → kept and flagged out of band", () => {
    const { merged, review, report } = mergeCatalog(
      { "text.Sales.orderNotFound": "Order not found" }, // BASE
      { "text.Sales.orderNotFound": "Commande introuvable" }, // OURS
      { "text.Sales.orderNotFound": "We couldn't find that order" }, // THEIRS
    );
    // The value stays a clean translation; the state lives in the sidecar.
    expect(merged["text.Sales.orderNotFound"]).toBe("Commande introuvable");
    expect(hasConflictMarkers(merged["text.Sales.orderNotFound"])).toBe(false);
    expect(review["text.Sales.orderNotFound"]).toEqual({
      translation: "Commande introuvable",
      previousSource: "Order not found",
      source: "We couldn't find that order",
    });
    expect(report.conflicted).toEqual(["text.Sales.orderNotFound"]);
  });
});

describe("mergeCatalog — placeholder renames", () => {
  const K = "WebApp.page.P.text.k1";

  it("a pure placeholder rename carries the translation with its holes renamed", () => {
    const { merged, report } = mergeCatalog(
      { [K]: "Order {id}" }, // BASE
      { [K]: "Commande {id}" }, // OURS
      { [K]: "Order {number}" }, // THEIRS
    );
    expect(merged[K]).toBe("Commande {number}");
    expect(hasConflictMarkers(merged[K])).toBe(false);
    expect(report.updated).toEqual([K]);
    expect(report.conflicted).toEqual([]);
  });

  it("renames by source position, so a translation that reorders its holes follows", () => {
    const { merged } = mergeCatalog(
      { [K]: "{a} then {b}" },
      { [K]: "{b} puis {a}" },
      { [K]: "{x} then {y}" },
    );
    expect(merged[K]).toBe("{y} puis {x}");
  });

  it("keeps a hole's format suffix and swaps names without chaining", () => {
    const { merged } = mergeCatalog(
      { [K]: "{a, number} / {b}" },
      { [K]: "{b} / {a, number}" },
      { [K]: "{b, number} / {a}" },
    );
    expect(merged[K]).toBe("{a} / {b, number}");
  });

  it("a real wording change next to a rename still needs review", () => {
    const { merged, report } = mergeCatalog(
      { [K]: "Order {id}" },
      { [K]: "Commande {id}" },
      { [K]: "Purchase {number}" },
    );
    expect(merged[K]).toBe("Commande {id}");
    expect(report.conflicted).toEqual([K]);
    expect(report.updated).toEqual([]);
  });

  it("a format change is a wording change, not a rename", () => {
    const { report } = mergeCatalog(
      { [K]: "Total {t, number}" },
      { [K]: "Total {t, number}" },
      { [K]: "Total {t, date}" },
    );
    expect(report.conflicted).toEqual([K]);
  });
});

describe("merge helpers", () => {
  it("output is key-sorted for a clean diff", () => {
    const { merged } = mergeCatalog({}, { "b.k": "b", "a.k": "a" }, { "b.k": "B", "a.k": "A" });
    expect(Object.keys(merged)).toEqual(["a.k", "b.k"]);
  });

  it("reportHasPending is true for added / dropped / conflicted, false when only kept", () => {
    const report = (over: Partial<MergeReport>): MergeReport => ({
      added: [],
      untranslated: [],
      kept: [],
      dropped: [],
      conflicted: [],
      updated: [],
      carried: [],
      ...over,
    });
    expect(reportHasPending(report({ added: ["x"] }))).toBe(true);
    expect(reportHasPending(report({ dropped: ["x"] }))).toBe(true);
    expect(reportHasPending(report({ conflicted: ["x"] }))).toBe(true);
    expect(reportHasPending(report({ updated: ["x"] }))).toBe(true);
    expect(reportHasPending(report({ kept: ["x"] }))).toBe(false);
    expect(reportHasPending(report({ untranslated: ["x"] }))).toBe(false);
    // A carry always coexists with the dropped donor it came from, so it needs
    // no arm of its own here - but a carry-only report is still not "nothing
    // to do", and the dropped key it implies is what says so.
    expect(reportHasPending(report({ carried: [{ key: "n", from: "o" }], dropped: ["o"] }))).toBe(
      true,
    );
  });

  it("conflictMarker (legacy) embeds all three sides in diff3 order", () => {
    const m = conflictMarker("ours", "base", "theirs");
    expect(m).toBe("<<<<<<< OURS\nours\n||||||| BASE\nbase\n=======\ntheirs\n>>>>>>> THEIRS");
  });
});

// ---------------------------------------------------------------------------
// Case 5 — the design-pack family swap (`pack.<family>.<role>.<hash>`).
//
// Swapping `design: shadcn@v4` -> `mui@v7` re-keys every chrome string the two
// packs spell identically.  Before this case the merge read that as a delete +
// an add and wrote `TODO: Remove` over a finished translation of a
// character-identical source - which the equal `<hash>` proves.
//
// The negatives are the point of the matrix: a REPHRASED string has a
// different hash and must STILL re-key (that is what hashing the message buys),
// and anything ambiguous must carry nothing at all.
// ---------------------------------------------------------------------------

// The shared FNV-1a hash of "Remove" is the same on both sides by construction;
// a literal stands in for it here so the test reads as a translator would see it.
const H_REMOVE = "k9d3x1";
const H_ADD = "p2q8z4";
const SHADCN_REMOVE = `pack.shadcn.removeItem.${H_REMOVE}`;
const MUI_REMOVE = `pack.mui.removeItem.${H_REMOVE}`;

describe("mergeCatalog - case 5, design-pack family swap", () => {
  it("carries a translation from the old family onto the new one", () => {
    const { merged, report } = mergeCatalog(
      { [SHADCN_REMOVE]: "Remove" }, // BASE - the lock remembers the English
      { [SHADCN_REMOVE]: "Entfernen" }, // OURS - finished translation
      { [MUI_REMOVE]: "Remove" }, // THEIRS - pack swapped, same message
    );
    expect(merged[MUI_REMOVE]).toBe("Entfernen");
    expect(isTodo(merged[MUI_REMOVE])).toBe(false);
    expect(report.carried).toEqual([{ key: MUI_REMOVE, from: SHADCN_REMOVE }]);
    expect(report.added).toEqual([]);
    // The donor key really is gone from the file, and says so.
    expect(report.dropped).toEqual([SHADCN_REMOVE]);
    expect(merged[SHADCN_REMOVE]).toBeUndefined();
  });

  it("does NOT carry a REPHRASED string - a different hash still re-keys", () => {
    const { merged, report } = mergeCatalog(
      { [SHADCN_REMOVE]: "Remove" },
      { [SHADCN_REMOVE]: "Entfernen" },
      // Same role - but the new pack words it differently, so the content hash
      // differs.  This is the case the hash exists to catch.
      { "pack.mui.removeItem.zz0000": "Delete item" },
    );
    expect("pack.mui.removeItem.zz0000" in merged).toBe(false);
    expect(report.carried).toEqual([]);
    expect(report.added).toEqual(["pack.mui.removeItem.zz0000"]);
  });

  it("does NOT carry across a different ROLE, even with the same message hash", () => {
    // "Close" the dialog control and "Close" the flash banner hash the same and
    // are different strings to a translator.
    const { merged, report } = mergeCatalog(
      { "pack.shadcn.closeDialog.aa1111": "Close" },
      { "pack.shadcn.closeDialog.aa1111": "Schliessen" },
      { "pack.daisyui.closeFlash.aa1111": "Close" },
    );
    expect("pack.daisyui.closeFlash.aa1111" in merged).toBe(false);
    expect(report.carried).toEqual([]);
  });

  it("carries nothing when TWO dropped families offer a translation for one new key", () => {
    const { merged, report } = mergeCatalog(
      {
        [SHADCN_REMOVE]: "Remove",
        [`pack.chakra.removeItem.${H_REMOVE}`]: "Remove",
      },
      {
        [SHADCN_REMOVE]: "Entfernen",
        [`pack.chakra.removeItem.${H_REMOVE}`]: "Loeschen",
      },
      { [MUI_REMOVE]: "Remove" },
    );
    // Whose wording wins?  Unanswerable, so nobody's - back to case 1.
    expect(MUI_REMOVE in merged).toBe(false);
    expect(report.carried).toEqual([]);
  });

  it("carries nothing when TWO new families both want one dropped translation", () => {
    const { merged, report } = mergeCatalog(
      { [SHADCN_REMOVE]: "Remove" },
      { [SHADCN_REMOVE]: "Entfernen" },
      {
        [MUI_REMOVE]: "Remove",
        [`pack.vuetify.removeItem.${H_REMOVE}`]: "Remove",
      },
    );
    expect(MUI_REMOVE in merged).toBe(false);
    expect(`pack.vuetify.removeItem.${H_REMOVE}` in merged).toBe(false);
    expect(report.carried).toEqual([]);
  });

  it("does NOT carry an untranslated donor (absent from OURS)", () => {
    const { merged, report } = mergeCatalog(
      { [SHADCN_REMOVE]: "Remove" },
      {},
      { [MUI_REMOVE]: "Remove" },
    );
    expect(MUI_REMOVE in merged).toBe(false);
    expect(report.carried).toEqual([]);
    expect(report.added).toEqual([MUI_REMOVE]);
  });

  it("does NOT carry a legacy conflict-marker donor value", () => {
    const { merged, report } = mergeCatalog(
      { [SHADCN_REMOVE]: "Remove" },
      { [SHADCN_REMOVE]: conflictMarker("Entfernen", "Remove", "Remove item") },
      { [MUI_REMOVE]: "Remove" },
    );
    expect(MUI_REMOVE in merged).toBe(false);
    expect(report.carried).toEqual([]);
  });

  it("does NOT carry when BASE has no record of the donor's English", () => {
    // The 6-char FNV-1a hash is collision-avoidance, not proof; BASE is the
    // proof.  A hand-made locale file with no lock gets no carry.
    const { merged, report } = mergeCatalog(
      {}, // BASE - no lock entry
      { [SHADCN_REMOVE]: "Entfernen" },
      { [MUI_REMOVE]: "Remove" },
    );
    expect(MUI_REMOVE in merged).toBe(false);
    expect(report.carried).toEqual([]);
  });

  it("does NOT carry when BASE's English disagrees with THEIRS (hash collision guard)", () => {
    const { merged, report } = mergeCatalog(
      { [SHADCN_REMOVE]: "Remove" },
      { [SHADCN_REMOVE]: "Entfernen" },
      { [MUI_REMOVE]: "Discard" }, // same hash, different message => a collision
    );
    expect(MUI_REMOVE in merged).toBe(false);
    expect(report.carried).toEqual([]);
  });

  it("leaves NON-pack namespaces alone - authored page text never carries", () => {
    // `page.*` keys are `page.<Page>.<role>.<hash>`: the same four-segment
    // shape, a completely different meaning.  Renaming a PAGE is an authoring
    // change, not a swap of who renders an unchanged string.
    const { merged, report } = mergeCatalog(
      { "page.OrderList.heading.h1": "Orders" },
      { "page.OrderList.heading.h1": "Commandes" },
      { "page.Shipments.heading.h1": "Orders" },
    );
    expect("page.Shipments.heading.h1" in merged).toBe(false);
    expect(report.carried).toEqual([]);
  });

  it("does NOT overwrite a translation the new key already has", () => {
    const { merged, report } = mergeCatalog(
      { [SHADCN_REMOVE]: "Remove", [MUI_REMOVE]: "Remove" },
      { [SHADCN_REMOVE]: "Entfernen", [MUI_REMOVE]: "Loeschen" },
      { [MUI_REMOVE]: "Remove" },
    );
    expect(merged[MUI_REMOVE]).toBe("Loeschen"); // case 3 wins; the donor is dropped
    expect(report.carried).toEqual([]);
    expect(report.kept).toEqual([MUI_REMOVE]);
  });

  it("does not ALSO park a carried donor in the stale sidecar with --keepStale", () => {
    const { merged, stale, report } = mergeCatalog(
      { [SHADCN_REMOVE]: "Remove" },
      { [SHADCN_REMOVE]: "Entfernen" },
      { [MUI_REMOVE]: "Remove" },
      { keepStale: true },
    );
    expect(merged[MUI_REMOVE]).toBe("Entfernen");
    // The translation moved; a second editable copy would just drift.
    expect(stale[SHADCN_REMOVE]).toBeUndefined();
    expect(report.dropped).toEqual([SHADCN_REMOVE]);
  });

  it("parks a genuinely stale pack key in the stale sidecar", () => {
    // A role the new pack does not declare at all has no target to carry to -
    // the ordinary case-2 drop still applies.
    const { stale, report } = mergeCatalog(
      { [`pack.shadcn.closeDialog.${H_ADD}`]: "Close" },
      { [`pack.shadcn.closeDialog.${H_ADD}`]: "Schliessen" },
      { [MUI_REMOVE]: "Remove" },
      { keepStale: true },
    );
    expect(stale[`pack.shadcn.closeDialog.${H_ADD}`]).toBe("Schliessen");
    expect(report.carried).toEqual([]);
  });

  it("carries several roles in one swap and reports each", () => {
    const shadcnAdd = `pack.shadcn.addItem.${H_ADD}`;
    const muiAdd = `pack.mui.addItem.${H_ADD}`;
    const { merged, report } = mergeCatalog(
      { [SHADCN_REMOVE]: "Remove", [shadcnAdd]: "Add {item}" },
      { [SHADCN_REMOVE]: "Entfernen", [shadcnAdd]: "{item} hinzufuegen" },
      { [MUI_REMOVE]: "Remove", [muiAdd]: "Add {item}" },
    );
    expect(merged[MUI_REMOVE]).toBe("Entfernen");
    expect(merged[muiAdd]).toBe("{item} hinzufuegen");
    expect(report.carried.map((c) => c.key).sort()).toEqual([muiAdd, MUI_REMOVE].sort());
    expect(report.added).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Out-of-band state: review flags, re-key hints, legacy migration.
// ---------------------------------------------------------------------------

describe("mergeCatalog - needs-review lifecycle", () => {
  const K = "text.Sales.orderNotFound";
  const flagged = {
    [K]: { translation: "Commande introuvable", previousSource: "Order not found", source: "Gone" },
  };

  it("keeps an open flag while the value is untouched, refreshing the source", () => {
    const { review } = mergeCatalog(
      { [K]: "Gone" },
      { [K]: "Commande introuvable" },
      { [K]: "Gone" },
      { review: flagged },
    );
    expect(review[K]).toEqual(flagged[K]);
  });

  it("clears the flag by itself once the translator edits the value", () => {
    const { merged, review } = mergeCatalog(
      { [K]: "Gone" },
      { [K]: "Commande introuvable (corrigee)" },
      { [K]: "Gone" },
      { review: flagged },
    );
    expect(merged[K]).toBe("Commande introuvable (corrigee)");
    expect(review).toEqual({});
  });
});

describe("mergeCatalog - re-key hints", () => {
  const OLD = "WebApp.page.Home.heading.aaaaaa";
  const NEW = "WebApp.page.Home.heading.bbbbbb";

  it("an untranslated key replacing a reworded one carries the previous source and translation", () => {
    const { merged, review, report } = mergeCatalog(
      { [OLD]: "Orders" },
      { [OLD]: "Commandes" },
      { [NEW]: "Order management" },
    );
    expect(merged).toEqual({});
    expect(review[NEW]).toEqual({
      previousSource: "Orders",
      previousTranslation: "Commandes",
      source: "Order management",
    });
    expect(report.dropped).toEqual([OLD]);
  });

  it("hints nothing when the pairing is ambiguous", () => {
    const NEW2 = "WebApp.page.Home.heading.cccccc";
    const { review } = mergeCatalog(
      { [OLD]: "Orders" },
      { [OLD]: "Commandes" },
      { [NEW]: "Order management", [NEW2]: "Order admin" },
    );
    expect(review).toEqual({});
  });

  it("keeps an existing hint until the key is translated", () => {
    const hint = { previousSource: "Orders", source: "Order management" };
    const kept = mergeCatalog(
      { [NEW]: "Order management" },
      {},
      { [NEW]: "Order management" },
      { review: { [NEW]: hint } },
    );
    expect(kept.review[NEW]).toEqual(hint);
    const done = mergeCatalog(
      { [NEW]: "Order management" },
      { [NEW]: "Gestion" },
      { [NEW]: "Order management" },
      { review: { [NEW]: hint } },
    );
    expect(done.review).toEqual({});
  });
});

describe("normalizeLegacy - in-band markers move out of band", () => {
  it("TODO values vanish, conflict blocks become value + flag, _stale keys move to stale", () => {
    const lifted = normalizeLegacy({
      "a.todo": `${TODO_PREFIX}Hello`,
      "a.done": "Bonjour",
      "a.conflict": conflictMarker("Salut", "Hi", "Hello"),
      "_stale.a.gone": "Au revoir",
    });
    expect(lifted.ours).toEqual({ "a.done": "Bonjour", "a.conflict": "Salut" });
    expect(lifted.review).toEqual({
      "a.conflict": { translation: "Salut", previousSource: "Hi", source: "Hello" },
    });
    expect(lifted.stale).toEqual({ "a.gone": "Au revoir" });
    expect(lifted.changed).toBe(3);
  });

  it("a file already in the new scheme is a no-op", () => {
    expect(normalizeLegacy({ "a.done": "Bonjour" }).changed).toBe(0);
  });
});
