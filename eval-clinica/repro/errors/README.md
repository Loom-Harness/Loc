# Diagnostic-quality battery

Ten deliberately-broken models, one realistic mistake each, used to measure the
quality of Loom's diagnostics (the table is in `../../EVAL-LOG.md` § Phase 6).

They carry a **`.ddd.txt`** extension on purpose. `test/system/ddd-source-census.test.ts`
sweeps every tracked `.ddd` in the repo and requires it to parse and validate — which is
the right rule, and these files exist precisely to violate it. Renaming keeps them
readable evidence without pinning eleven entries into a shared test file (which would
collide with #2911, who pins their equivalents there).

To run one:

```bash
cp errors/e02-missing-field.ddd.txt /tmp/x.ddd && node bin/cli.js parse /tmp/x.ddd
```

`../r01-duration-field.ddd.txt` and `../r04-soft-keyword-param.ddd.txt` are the same case:
both are *supposed* to be refused (they document an HONEST gap and a poor diagnostic).
