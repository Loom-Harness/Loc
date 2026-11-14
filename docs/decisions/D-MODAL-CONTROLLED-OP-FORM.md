# D-MODAL-CONTROLLED-OP-FORM — `Modal { open:, OperationForm }` is a supported shape and `open:` must be honoured

**Status:** applied — the proposed default took effect 2026-09-24 (merged to `main` 2026-09-22 in #2970; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).
Raised by wave C2 packet 2g (§1), which measured the row and asked for a ruling
before building; re-measured and ruled by packet 2k.

**Question.** `loom.modal-controlled-op-form-unsupported` refuses
`Modal { open: <stateBool>, OperationForm { … }, trigger: … }` on
react / vue / svelte / flutter. Its `CONTROLLED_MODAL_OP_FORM_FRAMEWORKS` set —
angular, feliz, phoenixLiveView — names the three that do NOT refuse it. But
read what those three do: each forks the primitive, renders the operation form,
and **drops the `open:` binding**, driving the dialog from its own trigger
(Angular: `renderAngularModal` builds its own `<opKey>Open` signal and never
looks at `open:`). So the "supported" behaviour is itself a degradation, and
the register's drain condition for the other four ("render the controlled shell
around the recorded `OperationFormState`") is a strictly higher bar. Which bar
is right?

**Options.** (a) match the degradation — let react/vue/svelte fall through to
the trigger-driven op-form modal with a synthesised trigger, ~20 lines in
`emitModal`, gate deleted, `MAX_OPEN_GAPS` −1; (b) honour `open:` everywhere,
and fix the three "supported" targets too.

**Decision.** **(b).** (a) would ship a silent drop of an authored binding on
seven targets instead of four, which is precisely the class this wave exists to
remove — and it would do it by DELETING the diagnostic that currently names it,
so the degradation would become unfindable. A `state` field bound to `open:` is
the author saying "I own this dialog's visibility"; a generated trigger button
they did not write is not that.

**Why it is not built here, and what it costs.** Measured on `main` at
`5049b6fea`:

* an `OperationForm` child emits NO inline markup (`walk(formChild, …)` returns
  `""`). The packs render it from `ctx.formOfs` through their own module
  component, and **that component owns its trigger**: shadcn wraps
  `<DialogTrigger asChild><Button …>`, mui/chakra emit `<Button onClick={() =>
  setOpen(true)}>` beside the dialog, and the Svelte packs open a
  `{{opCamel}}ModalOpen` local from their own button. A controlled shape needs
  a second template per pack — the op-form module rendered WITHOUT its trigger,
  driven by the page's state — across the JSX/Vue/Svelte packs;
* `designs/shadcnVue/v1/form-op-module.hbs` is currently
  `// TODO(vue-forms): operation modal/form module (v-dialog) lands in the
  forms slice`, so on Vue the uncontrolled shape is not built either: that pack
  needs the module before it can need a controlled variant;
* the three "supported" targets each need their fork taught to read `open:`,
  which is 2m's tree (HEEx) and 2l's (feliz) plus Angular's `modal.ts`.

That is a pack-layer packet, not a walker row, and it is HANDED OFF rather than
part-landed: a fix on react alone would re-introduce the per-target carve-out
the register records as the thing to remove.

**Register.** The row stays `kind: "gap"` under M-T1.6 with its membership set
unchanged. It is not re-classed `scope`, because this decision says the shape
IS supported — it is unbuilt work with a known shape and a measured cost, which
is what `gap` means.

**Affects.** `src/generator/_walker/primitives/forms.ts` (`emitModal` /
`emitControlledModal`); `designs/*/v*/form-op-module.hbs` +
`primitive-modal.hbs` across the JSX/Vue/Svelte packs;
`src/generator/angular/modal.ts`; `src/ir/validate/checks/ui-collection-display-checks.ts`
(`CONTROLLED_MODAL_OP_FORM_FRAMEWORKS`); mission M-T1.6.
