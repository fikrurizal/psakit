# Surrogate

A faster, more complete reimplementation of [Ersatz](https://www.epigear.com/index_files/ersatz.html) (Jan Barendregt, EpiGear) for Excel: Monte Carlo simulation, bootstrapping, microsimulation and probabilistic sensitivity analysis. It was written from the Ersatz User Guide and Function Overview. No Ersatz code was decompiled or reused.

Surrogate is not affiliated with or endorsed by EpiGear. Ersatz's site reads "All rights reserved", so check with EpiGear before distributing this publicly under a name or claim that links it to Ersatz.

## Why it is faster

Ersatz recalculates the workbook in Excel on every iteration. Surrogate reads the workbook once, compiles it, and runs the model outside Excel:

1. **Fixed formulas are left alone.** Anything that doesn't depend on a random function keeps the value Excel already calculated, including formulas using functions the compiler doesn't know.
2. **Unused formulas are skipped.** A live formula that feeds no ER. function isn't calculated at all.
3. **What's left runs as compiled JavaScript**, in dependency order, with no call into Excel per iteration.
4. **Runs and iterations split across CPU cores** when nothing ties them together. Ersatz planned multi-threading for version 2.0.

### It checks itself against Excel

Before each run, Surrogate draws 5 sets of random inputs, gives Excel exactly those draws, and compares every compiled cell with Excel's answer. If any cell differs, or a formula can't be compiled, that run uses Excel recalculation and the Results tab says which cell caused it. This can be switched off under Model, and doesn't run when a workbook's live formulas use `RAND`, because Excel's `RAND` can't be replayed.

### Measured speed

These runs used stand-in models built to resemble two slow Ersatz examples, in Chromium on a 2-core cloud container with 2 worker threads. To reproduce: `node benchmarks/run-node.js` and `node benchmarks/run-browser.js`.

| Model | Ersatz, per its User Guide | Surrogate |
| --- | --- | --- |
| Markov cohort model, 14 age groups × 2000 runs (28,000 iterations, 720 live formulas) | BreastCaMarkovMC: 1 min 20 s | 1.2 s |
| Individual-level model, 2448 people × 2000 runs (4.9 million iterations, 61 live formulas) | BreastCaMicroUnc: 1 h 20 min | 29 s |

**This is not a controlled head-to-head.** The Ersatz times are the author's, from his laptop, on his workbooks, which aren't available here. The stand-ins use invented numbers and my estimate of their size. The 2448 people is the guide's own example of a microsimulation size, not a confirmed figure for BreastCaMicroUnc. The real BreastCaMarkovMC uses `ErCondStoreArray`, so it would run on one thread, though the stand-in took about the same time on one thread. Treat the ratio as an order of magnitude, and time your own workbook.

Calculation that falls back to Excel will be slower than Ersatz, because an Office.js add-in has to cross a process boundary on every iteration.

## Status: not yet run in real Excel

Everything has been tested except the real thing, because Excel isn't available where this was built. See [Testing](#testing). Expect the first install to find something. In particular, whether Excel's Office.js returns exactly what the compiler expects for spilled cells is untested. The match check is designed to catch that kind of problem and fall back.

## Install

You need Excel for Microsoft 365, or Excel 2021 or later.

### For users

**Windows (no admin rights needed):**

1. Double-click `Install Surrogate.cmd`. If Windows warns about it, choose More info > Run anyway.
2. Open Excel and any workbook, then go to Home > Add-ins and click Surrogate under Developer Add-ins. From then on it has its own button on the Data tab.

The installer only saves the manifest to `%LOCALAPPDATA%\Surrogate` and adds one entry under `HKCU\Software\Microsoft\Office\16.0\WEF\Developer`, for the current user. `Uninstall Surrogate.cmd` removes both. Desktop Excel on Windows has no Upload My Add-in button, which is why the installer exists.

**Excel on the web:** Home > Add-ins > More Add-ins > Upload My Add-in, and choose `manifest.xml`. This also works where a company computer won't run the installer.

**Mac:** copy `manifest.xml` to `~/Library/Containers/com.microsoft.Excel/Data/Documents/wef/` and restart Excel, then Insert > My Add-ins.

To try it, open Surrogate, go to Tools, press Insert example model, then press Run simulation. If the panel stays on "Loading..." the first time, close it and click the Surrogate button on the Data tab again.

### For whoever distributes it

The add-in's files must be served over HTTPS. Users' workbooks are never sent anywhere: the add-in only downloads its own files and Microsoft's `office.js`.

1. Upload this whole folder to a static host, such as GitHub Pages or Cloudflare Pages, then point the manifest at it:
   ```
   npm run set-host -- https://you.github.io/surrogate
   ```
2. Build the installer, which embeds the manifest:
   ```
   npm run installer   # writes dist/Install Surrogate.cmd and dist/Uninstall Surrogate.cmd
   ```
3. Send users the two `.cmd` files, plus `manifest.xml` for Excel on the web or Mac.

Changes to the code reach users the next time Excel loads the add-in. Only a change to `manifest.xml` itself needs a new installer, and then raise its `<Version>` so Excel picks it up.

**For development, on your own computer (Node.js required):**

```
npm run certs      # once; trusts Microsoft's local development certificate
npm start          # serves on https://localhost:3000
npm run installer  # an installer pointing at localhost, for testing
```

## Using it

Functions keep their exact Ersatz names and argument order, with an `ER.` prefix that Excel requires for this kind of add-in:

| Ersatz | Surrogate |
| --- | --- |
| `=ErNormal(10,2)` | `=ER.ERNORMAL(10,2)` |
| `=ErOutput("Net cost",B20)` | `=ER.EROUTPUT("Net cost",B20)` |
| `=ErRankCorrCom(A3,1,ErWeibull(5,2.1))` | `=ER.ERRANKCORRCOM(A3,1,ER.ERWEIBULL(5,2.1))` |

To bring in an old workbook, save it as `.xlsx`, keep a copy, then use Tools > Convert formulas. The Ersatz [Function Overview](http://www.epigear.com/index_files/Ersatz%20Function%20Overview.pdf) and [User Guide](http://www.epigear.com/index_files/Ersatz%20User%20Guide.pdf) remain the best guides to modelling with these functions.

## Reports and the live window

Both are on the Results tab, and both show the same thing: a summary table, each output's distribution, running mean and drivers, then any cost-effectiveness and sensitivity analyses run since the simulation, and how the run was calculated.

- **Save HTML report** writes one self-contained file with this run's numbers. It needs no Excel, add-in or internet connection to open, it can be emailed, and it prints cleanly. It doesn't change after it's saved. Some versions of Excel block downloads from add-ins, so **Copy report HTML** is there as a fallback: paste it into a text file ending in `.html`.
- **Open live window** opens a resizable window beside the workbook, which updates after each run and each sensitivity analysis. It can start and stop runs, save a report, and rerun when the workbook changes (off by default). That rerun waits for a 1.2 second pause in editing, and ignores changes during a run, just after one, and from Surrogate writing results to a sheet.

The window isn't a live link to individual cells. It shows simulation results, so changing a cell only changes what it shows once a run finishes. It needs Dialog API 1.2 (Excel for Microsoft 365, or Excel 2021 and later); where that's missing, Surrogate says so and the saved report still works. Results reach it as text messages through Excel, sent in pieces of 20,000 characters because Microsoft's pages don't state a size limit. Whether Excel accepts that size is untested.

A report's output and input names come from the workbook and are treated as text, so they can't run anything in a saved file.

## Compared with Ersatz

### Matches Ersatz

All 88 functions. Iterations and multiple runs, ErRunOutput and ErRunSensInput. Conditional firing. Seven generators. Histograms, convergence, scatter, sorted and complete output, saved results. Univariate tornado analysis and Pearson, Spearman, Kendall, input-input and partial rank sensitivity. Distribution viewer. Correlation matrix check and repair.

The four optimisers, with the guide's options and defaults:

| Method | Options |
| --- | --- |
| Quasi-Newton (BFGS) | Tolerance 0.01, maximum tries 500 |
| Down-hill Simplex | Initial simplex 0.1, maximum tries 500, tolerance 0.01, noisy optimisation off, noise tolerance 0.0001 |
| Simulated Annealing | Initial simplex 0.1, maximum tries per level 500, starting temperature 10,000, tolerance 0.01, cooling factor 0.1 |
| Cross-Entropy | Proportion elite 0.1, coefficient of variation 1.0, sample size 150, maximum tries 100, variance threshold 0.01 |

Restarts (0 to 10), the Iteration option (draw, hold the draws, fit, record) with First iteration only, and the Run option (each loss evaluation is a run). Errors follow the guide: bad setups before a run are fatal, and a failure during a run is logged with its iteration and function, and that output gets no statistics.

### Goes beyond Ersatz

- **Speed**, as above, including multiple CPU cores.
- **Windows, Mac and web**, with Microsoft 365. The guide says Ersatz isn't compatible with cloud-based Office 365.
- **No installer, licence number or machine-specific release code.**
- **Reproducible seeds.** Each cell has its own random stream, so a seed gives the same draws in each cell whatever order things calculate in, and whatever the number of threads. The guide explains that Ersatz has no seed because a shared stream breaks when Excel reorders its calculation. This also gives common random numbers between versions of a model, with no need to paste input streams into the workbook.
- **Robust partial rank correlation.** The guide lists this as a known weak spot in Ersatz. A degenerate case shows as "n/a" here instead of an error.
- **Fuller deterministic sensitivity analysis.** Ersatz offers ±1 SD or ±10% of the mean, one input at a time. Surrogate adds each distribution's own interval, low and high values you enter, grouped tornado bars, two-way tables with a heatmap, and named scenarios. All of these export to a sheet.
- **Cost-effectiveness analysis:** cost-effectiveness plane, acceptability curve, net benefit and expected value of perfect information.
- **HTML reports and a live window.** See [Reports and the live window](#reports-and-the-live-window).
- **Standard error of the mean** in output statistics.
- **Input labels** taken from the text next to each input cell.
- **Spilling formulas** in place of Ctrl+Shift+Enter ranges you size yourself.
- Settings saved with the workbook.

### Doesn't match Ersatz

- **Macros before or after iterations and runs: not available.** Office.js add-ins can't call VBA. The guide itself advises avoiding macros, and most of its example uses (fitting with Solver, per-iteration logic) are covered by the optimisers and multiple runs. If you rely on macros, this is the one real gap.
- **Graph styling and copying to the clipboard:** not included. Results go to a sheet or a CSV file.
- **Marsaglia generators.** The guide doesn't identify them, so MWC256 and CMWC4096 are used, which meet its documented period. Streams are not bit-identical to Ersatz, so results match statistically, not number for number.
- **The "Check for errors while running" option** is always on. The guide says to leave it on.
- **`ER.ERRELATIVERISK` SD.** The mean equals RR as documented. The SD reported is that of the corrected distribution, whereas the guide prints the uncorrected formula.

## Checked against the Function Overview

Every function was compared with the Ersatz Function Overview v1.35: names, argument order, parameter rules and return behaviour. The check changed these:

- `ER.ERSURVIVAL` and `ER.ERSURVIVAL2` return `#NUM!` when all probabilities are zero or the name is over 25 characters. Survival past the table returns the highest x plus 1, whatever `ct` is. `ct` beyond the table returns the same value.
- `ER.ERMULTINOMIALCOM` requires a whole number of cases above 0.
- `ER.ERHYPERGEOMETRIC` allows M = 0.
- `ER.ERDATA` returns `#NUM!` when `itnum` exceeds the number of iterations.
- `ER.ERSTORE` and `ER.ERRETRIEVE` now carry across runs, and the same applies to arrays. The Overview says values can be retrieved "at the next iteration or run".
- `ER.ERCONDSTOREARRAY` stores as such on iteration 1 of each run. That lets it sum within each run, as BreastCaMarkovMC does, and still build up across runs when it fires only at a later iteration, as ConditionalStore does.

### Deliberate differences

- `ER.ERINVERSEGAUSSIAN` needs μ above 0, and `ER.ERNEGBINOMIAL` needs p above 0. The Overview's wording allows other values, but the distributions aren't defined there, so they return `#NUM!`.
- `ER.ERRELATIVERISK` reports the SD of the corrected distribution. The Overview prints the uncorrected formula.
- `ER.ERUNIFORM` reports a mean of (min + max) / 2. The Overview prints (max − min) / 2, which looks like a misprint.
- Continuous `ER.EREMPIRICAL` uses a cubic spline as documented, but integrates on a fine grid rather than by Romberg, and floors negative spline values at 0. It should cope better with the flat curves the Overview warns about.
- Array functions spill all their values instead of filling a range you sized. If a converted `ER.ERDATAARRAY` previously covered fewer rows than there are iterations, it now needs empty cells for the rest. Array formulas you enter by hand with Ctrl+Shift+Enter keep Excel's usual behaviour: extra values are cut off, and extra cells show `#N/A`.

### Still needs checking against Ersatz

Neither document settles these. Compare them first if you need to reproduce published results.

1. **`ER.ERANNUALCOSTDISC`, `ER.ERLYDISC`, `ER.ERHALYDISC`:** accrual is continuous between start and end. The Overview gives no formula, though it does describe the times as continuous.
2. **`ER.ERHALYDISC`:** `sy` and `ly` are treated as ages for looking up weights. Ages outside the range use the nearest weight.
3. **`ER.ERSURVIVAL`:** constant hazard within each interval, and a higher `rnd` means longer survival.
4. **Store behaviour across runs:** the two points above come from reading the Overview and the guide's example workbooks. BreastCaMarkovMC and ConditionalStore would confirm them.
5. **`ER.ERSTDEV` and `ER.ERPERCENTILE`:** sample SD (n − 1) and interpolated percentiles. Neither method is stated.
6. **Simulated Annealing:** restarts each temperature level from the best point found, and treats a billionth of the starting temperature as zero.

### Validating against Ersatz

The Overview notes that the Trial version leaves out `ErData`, `ErDataArray`, `ErRunDataArray` and some example workbooks, and its statistical function entries say the same. A full comparison needs a licensed copy.

## What can't be compiled yet

These fall back to Excel when they're in a live formula, meaning one that depends on a random function. In a fixed formula they're fine.

- Functions outside the compiled list, such as `XLOOKUP`, `FILTER`, `SORT`, `TEXT`, date functions, VBA functions and other add-ins' functions. The Results tab names the cell and function.
- `OFFSET` and `INDIRECT` anywhere in the workbook, since their references aren't known until they run.
- Formulas that spill several values, other than ER. functions. Whole-column `INDEX` (row or column 0).
- Circular references.
- `ISNA` and `IFNA` around anything but a lookup. `ISERR` and `ERROR.TYPE`, because compiled errors don't keep their type.

## Known limitations

- Two calls to the same random function in one cell share an input record, so sensitivity analysis sees one of them. Give each input its own cell.
- `ER.ERNONPARAMCOM` and `ER.ERRANDOMISECOM` treat `val` as data that doesn't change within a run.
- Deterministic sensitivity analysis runs through Excel, and varies distribution functions only. Component inputs, such as Dirichlet shares, stay at their means, because moving one alone would break their sum.
- The same seed gives different numbers through the compiled path and the Excel path, and between thread-split and single-thread modes. It's reproducible for a given workbook and settings.
- Models with statistical functions, stores or rank correlation can't split iterations across threads, because iterations depend on each other. They can still split runs, unless they use `ER.ERCONDSTOREARRAY` or stores, which tie runs together. They still gain from compiling.
- If nothing depends on a live formula, it's skipped, so the sheet doesn't show its value after a run.
- Excel recalculates all open workbooks during fallback runs, so close others to go faster.

## Testing

```
npm test                                                  # simulation suite through both paths, compiler, distributions
PLAYWRIGHT_PATH=... node tests/excel-binding.browser.js   # the shipped pane in Chromium, against a stand-in for Office.js
python3 tests/oracle/generate.py                          # rebuild the LibreOffice reference (needs LibreOffice, openpyxl)
```

- **Compiler against a real spreadsheet engine.** 244 formulas were calculated by LibreOffice and compared with the compiled result, on both live and fixed data. 238 match. The other 6 are places where LibreOffice differs from Excel's documented behaviour. They're listed in `tests/compiler.test.js`, and Excel's behaviour is what's implemented.
- **Same suite, both paths.** Every simulation test runs through the compiled path and through recalculation.
- **Distributions** against the documented mean and SD over 400,000 draws each. Mersenne Twister and Park-Miller against published reference values.
- **Threads.** The real `worker.js` runs in Chromium. The test suite confirms that results are identical across thread counts, and that blocks don't repeat draws.
- **Optimisers.** The guide's OptimizationIt and OptimizationRun patterns, with each fit compared to the exact answer.
- **Reports.** Report figures are compared with the recorded values and a direct calculation. The saved file is opened on its own, to confirm that it loads nothing from elsewhere and that hostile names stay inert.
- **Live window.** The real `dashboard.html` runs against a stand-in for Excel's dialog, passing only text. This covers run, stop, rerun on change, reopening and a failed load. It doesn't show how real Excel behaves.

**Not tested:** real Excel, including its dialog window, change events and downloads, manifest validation against Microsoft's schema (`npx office-addin-manifest validate manifest.xml`), and numerical comparison with Ersatz itself. Running the Ersatz example workbooks through both would settle that, and the assumptions above.

## Layout

```
manifest.xml              Excel add-in manifest
src/engine/               Distributions, generators, formula compiler, run logic, thread pool. No Office dependency
src/functions/            Function registration and generated metadata
src/host/excel-host.js    All Office.js workbook calls
src/taskpane/             Interface, charts, HTML report and live window
tools/                    Local server, metadata generator, simulated workbook, demo builder
tests/, benchmarks/       Test suites and timing scripts
```
