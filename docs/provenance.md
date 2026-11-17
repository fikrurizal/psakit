# Provenance: where PSAkit's behaviour comes from

PSAkit implements the Ersatz function set. This note records what that implementation was built from, where it deliberately differs, and what is still uncertain.

## Sources

The function set (names, argument order, parameter rules, return behaviour and run options) comes only from EpiGear's public documents:

- *Ersatz Function Overview*, v1.35: <http://www.epigear.com/index_files/Ersatz%20Function%20Overview.pdf>
- *Ersatz User Guide*: <http://www.epigear.com/index_files/Ersatz%20User%20Guide.pdf>
- Ersatz home page: <https://www.epigear.com/index_files/ersatz.html>

No Ersatz code was used, decompiled or inspected. The engine's algorithms (random number generators, distribution samplers, optimisers, statistics) are standard published methods. The comments at the top of each file in `src/engine/` name the method or document each one follows.

PSAkit is not affiliated with or endorsed by EpiGear.

## Names

Internally the catalogue (`src/engine/spec.js`) keeps the Ersatz names (`ErBeta`), so it can be checked against the Function Overview line by line. Users see PSAkit's names: the `PSA.` namespace plus the name without "Er". The one exception is `ErChi2`, which becomes `PSA.CHISQ`, because `CHI2` on its own reads as a cell reference.

| Ersatz | PSAkit |
| --- | --- |
| `=ErNormal(10,2)` | `=PSA.NORMAL(10,2)` |
| `=ErOutput("Net cost",B20)` | `=PSA.OUTPUT("Net cost",B20)` |
| `=ErRankCorrCom(A3,1,ErWeibull(5,2.1))` | `=PSA.RANKCORRCOM(A3,1,PSA.WEIBULL(5,2.1))` |
| `=ErChi2(3)` | `=PSA.CHISQ(3)` |

The converter (Tools > Convert formulas) also accepts formulas from the prototype add-in, which used `=ER.ERNORMAL(...)`.

## Coverage

All 88 functions in the Function Overview. Iterations and multiple runs, ErRunOutput and ErRunSensInput. Conditional firing. Seven generators. Histograms, convergence, scatter, sorted and complete output, saved results. Univariate tornado analysis and Pearson, Spearman, Kendall, input-input and partial rank sensitivity. Distribution viewer. Correlation matrix check and repair.

The four optimisers, with the User Guide's options and defaults:

| Method | Options |
| --- | --- |
| Quasi-Newton (BFGS) | Tolerance 0.01, maximum tries 500 |
| Down-hill Simplex | Initial simplex 0.1, maximum tries 500, tolerance 0.01, noisy optimisation off, noise tolerance 0.0001 |
| Simulated Annealing | Initial simplex 0.1, maximum tries per level 500, starting temperature 10,000, tolerance 0.01, cooling factor 0.1 |
| Cross-Entropy | Proportion elite 0.1, coefficient of variation 1.0, sample size 150, maximum tries 100, variance threshold 0.01 |

Restarts (0 to 10), the Iteration option (draw, hold the draws, fit, record) with First iteration only, and the Run option (each loss evaluation is a run). Errors follow the guide: a bad setup before a run is fatal, and a failure during a run is logged with its iteration and function, and that output gets no statistics.

## Not available

- **Macros before or after iterations and runs.** Office.js add-ins can't call VBA. The guide itself advises avoiding macros, and most of its examples (fitting with Solver, per-iteration logic) are covered by the optimisers and multiple runs.
- **Graph styling and copying to the clipboard.** Results go to a sheet, a CSV file or an HTML report instead.
- **The "Check for errors while running" option** is always on. The guide says to leave it on.

## Differences on purpose

- **Generators.** The guide doesn't identify its Marsaglia generators, so MWC256 and CMWC4096 are used, which meet its documented period. Streams are not bit-identical to Ersatz, so results match statistically, not number for number.
- **Seeds.** Each cell has its own random stream, so a seed gives the same draws whatever order Excel calculates in, and whatever the number of threads. The guide explains that Ersatz has no seed because a shared stream breaks when Excel reorders its calculation.
- `PSA.INVERSEGAUSSIAN` needs μ above 0, and `PSA.NEGBINOMIAL` needs p above 0. The Overview's wording allows other values, but the distributions aren't defined there, so they return `#NUM!`.
- `PSA.RELATIVERISK` reports the SD of the corrected distribution. Its mean equals RR as documented, but the Overview prints the uncorrected formula for the SD.
- `PSA.UNIFORM` reports a mean of (min + max) / 2. The Overview prints (max − min) / 2, which looks like a misprint.
- Continuous `PSA.EMPIRICAL` uses a cubic spline as documented, but integrates on a fine grid rather than by Romberg integration, and floors negative spline values at 0.
- **Array functions spill** all their values instead of filling a range you sized. If a converted `PSA.DATAARRAY` previously covered fewer rows than there are iterations, it needs empty cells for the rest. Array formulas entered by hand with Ctrl+Shift+Enter keep Excel's usual behaviour.
- **Partial rank correlation** shows "n/a" for a degenerate case, where the guide lists an error as a known weak spot.

## Decisions taken where the Overview was unclear

Checking every function against the Overview v1.35 led to these readings:

- `PSA.SURVIVAL` and `PSA.SURVIVAL2` return `#NUM!` when all probabilities are zero or the name is over 25 characters. Survival past the table returns the highest x plus 1, whatever `ct` is. `ct` beyond the table returns the same value.
- `PSA.MULTINOMIALCOM` requires a whole number of cases above 0.
- `PSA.HYPERGEOMETRIC` allows M = 0.
- `PSA.DATA` returns `#NUM!` when `itnum` exceeds the number of iterations.
- `PSA.STORE` and `PSA.RETRIEVE` carry across runs, and the same applies to arrays. The Overview says values can be retrieved "at the next iteration or run".
- `PSA.CONDSTOREARRAY` stores as such on iteration 1 of each run. That lets it sum within each run, as the BreastCaMarkovMC example does, and still build up across runs when it fires only at a later iteration, as the ConditionalStore example does.

## Still open

Neither document settles these. Compare them first if you need to reproduce published Ersatz results.

1. `PSA.ANNUALCOSTDISC`, `PSA.LYDISC`, `PSA.HALYDISC`: accrual is continuous between start and end. The Overview gives no formula, though it does describe the times as continuous.
2. `PSA.HALYDISC`: `sy` and `ly` are treated as ages for looking up weights. Ages outside the range use the nearest weight.
3. `PSA.SURVIVAL`: constant hazard within each interval, and a higher `rnd` means longer survival.
4. Store behaviour across runs: the readings above come from the Overview and the guide's example workbooks. BreastCaMarkovMC and ConditionalStore would confirm them.
5. `PSA.STDEV` and `PSA.PERCENTILE`: sample SD (n − 1) and interpolated percentiles. Neither method is stated.
6. Simulated Annealing: restarts each temperature level from the best point found, and treats a billionth of the starting temperature as zero.

Settling them needs a licensed copy of Ersatz. The Trial version leaves out `ErData`, `ErDataArray`, `ErRunDataArray` and some example workbooks.

## Speed compared with the User Guide's timings

These runs used stand-in models built to resemble two slow examples from the User Guide, in Chromium on a 2-core cloud container with 2 worker threads (`node benchmarks/run-node.js`, `node benchmarks/run-browser.js`).

| Model | Ersatz, per its User Guide | PSAkit |
| --- | --- | --- |
| Markov cohort model, 14 age groups × 2000 runs (28,000 iterations, 720 live formulas) | BreastCaMarkovMC: 1 min 20 s | 1.2 s |
| Individual-level model, 2448 people × 2000 runs (4.9 million iterations, 61 live formulas) | BreastCaMicroUnc: 1 h 20 min | 29 s |

**This is not a controlled comparison.** The Ersatz times are the guide author's, on his laptop and his workbooks, which aren't available here. The stand-ins use invented numbers and an estimate of their size. Treat the ratio as an order of magnitude. On a real workbook in Excel for Microsoft 365 on Windows, the example model ran 2,000 iterations in about 8 seconds.

## History

PSAkit started as a prototype called "Surrogate", written with Claude from the two Ersatz documents above. It was renamed, given its own function names and restructured in November 2026. The renaming and the reasons for it are in [design.md](design.md).
