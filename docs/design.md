# Design: PSAkit, an Ersatz-compatible PSA add-in for Excel

Name: **PSAkit**, function prefix `PSA.` (chosen November 2026). "Surrogate" was retired, because it is a translation of "Ersatz" (German for substitute).

Status: version 0.1, for personal use, local only. Nothing published.
Owner: Fikru Rizal. Started from the owner's earlier prototype, "Surrogate".

---

## 1. Aim

A free, maintained Excel add-in for **probabilistic analysis of health-economic decision models**: Monte Carlo simulation, probabilistic sensitivity analysis (PSA) and microsimulation. It is fast, reproducible and runs in today's Excel.

It does this by **implementing the Ersatz function set**, from Ersatz's public documentation, so that:

- existing Ersatz workbooks can be converted and keep working, and
- modellers who learned Ersatz can keep the same way of working,

and then **adding what Ersatz lacks**: speed, Mac and web support, reproducible seeds, and cost-effectiveness outputs.

## 2. What it is, said plainly

- It is a **compatible reimplementation**, not an independent invention. Its functions, arguments and behaviour follow the *Ersatz Function Overview* and *User Guide* (EpiGear). This is stated in the README, in the add-in's About text and in the provenance note (section 7).
- No Ersatz code was used or decompiled. The specification comes only from public documents.
- It is **not affiliated with or endorsed by EpiGear**, and does not use the Ersatz name or branding as its own.
- EpiGear has been told about the plan informally. The owner will tell them about PSAkit properly once it runs well.

Comparable cases: LibreOffice implements Excel's function set, and many statistics packages implement another package's syntax. Being compatible is a legitimate aim if it is open about it.

## 3. Users and core jobs

The main users are health economists with decision models (Markov models, decision trees, cohort or individual-level models) in Excel.

1. Attach uncertainty to inputs (distributions, correlated inputs, Dirichlet for transition probabilities).
2. Run thousands of iterations quickly, with a seed so the results can be reproduced.
3. Get PSA outputs: summary statistics, cost-effectiveness plane, acceptability curve, net benefit, EVPI.
4. Run deterministic sensitivity analysis (tornado, two-way, scenarios).
5. Produce a report that someone else can open and check.
6. Bring in an old Ersatz model without rebuilding it.

## 4. Structure: two layers on one engine

| Layer | What it is | Source of truth |
| --- | --- | --- |
| **Engine** | Random number generators, distributions, the formula compiler, the run loop, threads, statistics | Standard algorithms and textbooks, each cited in the provenance note |
| **Compatibility layer** | The 88 Ersatz-equivalent functions, with the same arguments and behaviour, under our own names, plus the converter | Ersatz Function Overview v1.35 and User Guide |
| **PSA layer** (ours) | Health-economics additions: inputs given as mean and SE or as a CI, CEA outputs, EVPI, reports | Standard health-economics methods (e.g. Briggs, Claxton & Sculpher 2006) |

The engine has no dependency on Office or on Ersatz. The compatibility layer is a thin catalogue that maps function names onto the engine. The prototype's code already mostly splits this way: `src/engine` has no Office dependency, and `src/engine/spec.js` is the catalogue.

## 5. Naming

**Product name:** to be decided. Criteria:
- Its own name, not a synonym or translation of "Ersatz".
- It describes the job (PSA or Monte Carlo in Excel).
- Short, easy to say, and works as a function prefix.
- No clash with existing products: check GitHub, AppSource and a web search before choosing.

Chosen: **PSAkit** (`PSA.`). Checked on GitHub, npm and the web in November 2026: no product of that name. "PSA" itself is a very common abbreviation, so the name is hard to search for, which matters little for personal use. Montecell (`MC.`) and Stochell were also clear. Drawcell clashes with an R package. No formal trademark search was done.

**Function names: our own, with the same behaviour.** Excel puts every function under the add-in's prefix. The prototype uses `ER.ERBETA(...)`, which repeats Ersatz's "Er" prefix. Proposal: drop the "Er" prefix and use our own namespace:

| Ersatz | Prototype | Proposed (with `PSA.` as the example) |
| --- | --- | --- |
| `=ErBeta(a,b)` | `=ER.ERBETA(a,b)` | `=PSA.BETA(a,b)` |
| `=ErOutput("Cost",B20)` | `=ER.EROUTPUT(...)` | `=PSA.OUTPUT("Cost",B20)` |
| `=ErDirichletCom(...)` | `=ER.ERDIRICHLETCOM(...)` | `=PSA.DIRICHLETCOM(...)` |
| `=ErChi2(k)` | `=ER.ERCHI2(k)` | `=PSA.CHISQ(k)` (CHI2 reads as a cell reference) |

The arguments and behaviour stay identical, so the converter only has to change names. The PSA layer adds functions such as `PSA.BETA.MEANSE(mean, se)` and `PSA.GAMMA.MEANSE(mean, se)`. Where a name is the same in both layers, the Ersatz behaviour wins, so converted workbooks always behave as before.

## 6. Scope of the first version

No preference was given, so the recommendation is:

- **Keep the full compatibility layer.** It already exists and is tested, and full coverage is what makes converting a workbook trustworthy. Removing functions would break conversions.
- **Keep the PSA layer small at first:** mean-and-SE or CI versions of Beta, Gamma, Lognormal and Normal. The CEA outputs, tornado and reports already exist.
- **Leave out for now:** the Ersatz features the guide itself marks as rarely needed, and anything that needs VBA macros, which Office.js add-ins can't run.

## 7. Process and provenance

1. **Spec first.** `docs/spec.md` lists each function: name, Ersatz equivalent, arguments, behaviour, and the document section or textbook it comes from. From now on, the spec is the reference for code changes.
2. **Provenance note.** `docs/provenance.md` lists the public sources used (the Ersatz Function Overview v1.35, the User Guide, textbooks and papers). It states that no Ersatz code was used, and records the open questions where the documents were ambiguous. Those are already listed in the prototype README under "Still needs checking against Ersatz".
3. **Rename and restructure** to the new name and namespace (section 10).
4. **Validate** (section 8).
5. **Distribute:** installer and hosting. These already work for the prototype and only need the new name and Id.

## 8. Validation

Two independent tracks:

- **Against the documentation:** what the prototype already does. Distribution moments over 400,000 draws, the formula compiler against LibreOffice (238 of 244 formulas match, and the six differences follow Excel's documented behaviour), and both calculation paths giving the same answers.
- **Against published health-economic models (new):** rebuild one or two textbook PSA examples, such as the Briggs, Claxton & Sculpher exercise models, and check the outputs (mean costs and QALYs, ICER, acceptability curve) against the published results. This is the evidence health economists will trust, and it doesn't depend on access to Ersatz.
- **Against Ersatz itself (optional):** only with a licensed copy, to settle the open questions in the provenance note.

## 9. Where it lives

The project lives in its own folder, `C:\Users\friz0005\psakit` (moved out of `misc` on 17 November 2026), and keeps the prototype's git history. The code is at https://github.com/fikrurizal/psakit and the add-in is served from GitHub Pages at https://fikrurizal.github.io/psakit.

## 10. Restructure checklist (after naming)

- [x] Choose the name and check for clashes
- [x] New add-in Id (GUID), display name, provider name and function namespace in `manifest.xml`
- [x] Rename functions in `src/engine/spec.js` and regenerate `src/functions/functions.json`
- [x] Converter maps `ErX(` to the new `<NS>.X(`, and also the prototype's `ER.ERX(`
- [x] User-facing text: pane, report and installer messages
- [x] Rewrite the README around sections 1 to 3, with the compatibility statement and credits
- [x] `docs/provenance.md`
- [ ] `docs/spec.md`: one line per function with its source
- [x] Update tests and benchmarks for the new names. Keep the Ersatz-comparison notes in the provenance doc, not in the product's own text
- [x] Move to the new project folder
- [ ] Tell EpiGear once it runs well (owner, informally)

## 11. Open decisions

1. Scope: confirm section 6. No preference given yet, so the recommendation stands.
2. Decided 17 November 2026: the prototype's git history is kept.
3. Licence. The repository is public from 17 November 2026 with no licence (all rights reserved) until one is chosen.
4. Done 17 November 2026: the project moved out of `misc` into its own folder.
