# PSAkit

Probabilistic sensitivity analysis (PSA) and Monte Carlo simulation for decision models in Excel. It's built for health-economic models (Markov cohort models, decision trees and individual-level microsimulation), and works for any Excel model with uncertain inputs.

PSAkit implements the function set of [Ersatz](https://www.epigear.com/index_files/ersatz.html) (Jan Barendregt, EpiGear), so Ersatz models can be converted and keep working. It was built only from Ersatz's public documentation, the Function Overview and the User Guide. No Ersatz code was used. PSAkit is not affiliated with or endorsed by EpiGear. Where each behaviour comes from, and where it differs, is recorded in [docs/provenance.md](docs/provenance.md).

**Status:** version 0.1, a personal project. It runs in Excel for Microsoft 365 on Windows, where the example model and the test suites pass. It has not yet been checked against published health-economic models. See [docs/design.md](docs/design.md) for the aims and the plan.

## What it does

- **Random inputs as worksheet functions:** 35 distributions, correlated and rank-correlated inputs, Dirichlet and multinomial splits, and empirical and survival tables. For example, `=PSA.BETA(30,70)` or `=PSA.DIRICHLETCOM("severity",1,55)`.
- **Outputs** with `=PSA.OUTPUT("Net cost",B20)`: summary statistics with standard errors, histograms, convergence, and the inputs that drive each output.
- **Iterations and runs** for PSA, bootstrapping and microsimulation (outer and inner loops).
- **Cost-effectiveness analysis:** cost-effectiveness plane, acceptability curve, net benefit and expected value of perfect information.
- **Deterministic sensitivity analysis:** tornado diagrams (±1 SD, ±10%, each distribution's own interval, or your own low and high values), two-way tables and named scenarios.
- **Optimisers** for calibration (quasi-Newton, down-hill simplex, simulated annealing, cross-entropy).
- **Reproducible seeds** and **fast runs** (see below), on Windows, Mac and Excel on the web.
- **HTML reports** that open anywhere, and a live results window.

## Install

You need Excel for Microsoft 365, or Excel 2021 or later.

### For users

**Windows (no admin rights needed):**

1. Double-click `Install PSAkit.cmd`. If Windows warns about it, choose More info > Run anyway.
2. Open Excel and any workbook, then go to Home > Add-ins and click PSAkit under Developer Add-ins. From then on it has its own button on the Data tab.

The installer only saves the manifest to `%LOCALAPPDATA%\PSAkit` and adds one entry under `HKCU\Software\Microsoft\Office\16.0\WEF\Developer`, for the current user. `Uninstall PSAkit.cmd` removes both. Desktop Excel on Windows has no Upload My Add-in button, which is why the installer exists.

**Excel on the web:** Home > Add-ins > More Add-ins > Upload My Add-in, and choose `manifest.xml`. This also works where a company computer won't run the installer.

**Mac:** copy `manifest.xml` to `~/Library/Containers/com.microsoft.Excel/Data/Documents/wef/` and restart Excel, then Insert > My Add-ins.

To try it, open PSAkit, go to Tools, press Insert example model, then press Run simulation. If the panel stays on "Loading..." the first time, close it and click the PSAkit button on the Data tab again.

### Hosting it for others

The add-in's files must be served over HTTPS. Workbooks are never sent anywhere: the add-in only downloads its own files and Microsoft's `office.js`, and every calculation runs on the user's own computer.

1. Upload this folder to a static host, such as GitHub Pages, then point the manifest at it:
   ```
   npm run set-host -- https://you.github.io/psakit
   ```
2. Build the installer, which embeds the manifest:
   ```
   npm run installer   # writes dist/Install PSAkit.cmd and dist/Uninstall PSAkit.cmd
   ```
3. Send users the two `.cmd` files, plus `manifest.xml` for Excel on the web or Mac.

Changes to the code reach users the next time Excel loads the add-in. Only a change to `manifest.xml` itself needs a new installer, and then raise its `<Version>` so Excel picks it up.

### On your own computer, for development (Node.js required)

```
npm run certs      # once; trusts Microsoft's local development certificate
npm start          # serves on https://localhost:3000
npm run installer  # an installer pointing at localhost
```

## Using it

Every function is in the `PSA.` namespace. Type `=PSA.` in a cell to see the list. Arguments and behaviour match the Ersatz function of the same name without its "Er":

| Ersatz | PSAkit |
| --- | --- |
| `=ErNormal(10,2)` | `=PSA.NORMAL(10,2)` |
| `=ErOutput("Net cost",B20)` | `=PSA.OUTPUT("Net cost",B20)` |
| `=ErRankCorrCom(A3,1,ErWeibull(5,2.1))` | `=PSA.RANKCORRCOM(A3,1,PSA.WEIBULL(5,2.1))` |

The one exception is `ErChi2`, which is `PSA.CHISQ`, because `CHI2` on its own reads as a cell reference.

To bring in an Ersatz workbook, save it as `.xlsx` and keep a copy, then use Tools > Convert formulas. The converter also updates workbooks made with the earlier prototype (`=ER.ERNORMAL(...)`). The Ersatz [Function Overview](http://www.epigear.com/index_files/Ersatz%20Function%20Overview.pdf) and [User Guide](http://www.epigear.com/index_files/Ersatz%20User%20Guide.pdf) remain good guides to modelling with these functions.

## Why it's fast

Ersatz recalculates the workbook in Excel on every iteration. PSAkit reads the workbook once, compiles it, and runs the model outside Excel:

1. **Fixed formulas are left alone.** Anything that doesn't depend on a random function keeps the value Excel already calculated, including formulas using functions the compiler doesn't know.
2. **Unused formulas are skipped.** A live formula that feeds no PSA. function isn't calculated at all.
3. **What's left runs as compiled JavaScript**, in dependency order, with no call into Excel per iteration.
4. **Runs and iterations split across CPU cores** when nothing ties them together.

On Excel for Microsoft 365 on Windows, the example model runs 2,000 iterations in about 8 seconds on 11 threads. Timings for larger models are in [docs/provenance.md](docs/provenance.md#speed-compared-with-the-user-guides-timings). Calculation that falls back to Excel is much slower, because an Office.js add-in has to cross a process boundary on every iteration.

### It checks itself against Excel

Before each run, PSAkit draws 5 sets of random inputs, gives Excel exactly those draws, and compares every compiled cell with Excel's answer. If any cell differs, or a formula can't be compiled, that run uses Excel recalculation and the Results tab says which cell caused it. This can be switched off under Model. It doesn't run when a workbook's live formulas use `RAND`, because Excel's `RAND` can't be replayed.

## Reports and the live window

Both are on the Results tab, and both show the same thing: a summary table, each output's distribution, running mean and drivers, then any cost-effectiveness and sensitivity analyses run since the simulation, and how the run was calculated.

- **Save HTML report** writes one self-contained file with this run's numbers. It needs no Excel, add-in or internet connection to open, it can be emailed, and it prints cleanly. It doesn't change after it's saved. Some versions of Excel block downloads from add-ins, so **Copy report HTML** is there as a fallback: paste it into a text file ending in `.html`.
- **Open live window** opens a resizable window beside the workbook, which updates after each run and each sensitivity analysis. It can start and stop runs, save a report, and rerun when the workbook changes (off by default). That rerun waits for a 1.2-second pause in editing, and ignores changes during a run, just after one, and from PSAkit writing results to a sheet.

The window shows simulation results, not individual cells, so changing a cell only changes what it shows once a run finishes. It needs Dialog API 1.2 (Excel for Microsoft 365, or Excel 2021 and later). Where that's missing, PSAkit says so and the saved report still works.

A report's output and input names come from the workbook and are treated as text, so they can't run anything in a saved file.

## What can't be compiled yet

These fall back to Excel when they're in a live formula, meaning one that depends on a random function. In a fixed formula they're fine.

- Functions outside the compiled list, such as `XLOOKUP`, `FILTER`, `SORT`, `TEXT`, date functions, VBA functions and other add-ins' functions. The Results tab names the cell and function.
- `OFFSET` and `INDIRECT` anywhere in the workbook, since their references aren't known until they run.
- Formulas that spill several values, other than PSA. functions. Whole-column `INDEX` (row or column 0).
- Circular references.
- `ISNA` and `IFNA` around anything but a lookup. `ISERR` and `ERROR.TYPE`, because compiled errors don't keep their type.

## Known limitations

- **Macros** before or after iterations and runs aren't available, because Office.js add-ins can't call VBA.
- Two calls to the same random function in one cell share an input record, so sensitivity analysis sees one of them. Give each input its own cell.
- `PSA.NONPARAMCOM` and `PSA.RANDOMISECOM` treat `val` as data that doesn't change within a run.
- Deterministic sensitivity analysis runs through Excel, and varies distribution functions only. Component inputs, such as Dirichlet shares, stay at their means, because moving one alone would break their sum.
- The same seed gives different numbers through the compiled path and the Excel path, and between thread-split and single-thread modes. It's reproducible for a given workbook and settings.
- Models with statistical functions, stores or rank correlation can't split iterations across threads, because iterations depend on each other. They can still split runs, unless they use `PSA.CONDSTOREARRAY` or stores, which tie runs together. They still gain from compiling.
- If nothing depends on a live formula, it's skipped, so the sheet doesn't show its value after a run.
- Excel recalculates all open workbooks during fallback runs, so close others to go faster.

## Testing

```
npm test                                                  # simulation suite through both paths, compiler, distributions
PLAYWRIGHT_PATH=... node tests/excel-binding.browser.js   # the shipped pane in Chromium, against a stand-in for Office.js
python3 tests/oracle/generate.py                          # rebuild the LibreOffice reference (needs LibreOffice, openpyxl)
```

`npm test` sets an environment variable the Unix way. On Windows, run it from Git Bash, or run `node --test tests/*.test.js`.

- **In Excel:** installed with `Install PSAkit.cmd` in Excel for Microsoft 365 on Windows. The example model runs through the compiled path, and its pre-run check matches Excel on every cell.
- **Compiler against a real spreadsheet engine:** 244 formulas were calculated by LibreOffice and compared with the compiled result, on both live and fixed data. 238 match. The other 6 are places where LibreOffice differs from Excel's documented behaviour. They're listed in `tests/compiler.test.js`, and Excel's behaviour is what's implemented.
- **Same suite, both paths:** every simulation test runs through the compiled path and through recalculation.
- **Distributions** against the documented mean and SD over 400,000 draws each. Mersenne Twister and Park-Miller against published reference values.
- **Threads:** the real `worker.js` runs in Chromium. Results are identical across thread counts, and blocks don't repeat draws.
- **Optimisers:** the User Guide's OptimizationIt and OptimizationRun patterns, with each fit compared to the exact answer.
- **Reports:** figures are compared with the recorded values and a direct calculation. The saved file is opened on its own, to confirm that it loads nothing from elsewhere and that hostile names stay inert.
- **Live window:** the real `dashboard.html` runs against a stand-in for Excel's dialog. Not yet tried in real Excel.

**Not yet tested:** published health-economic models (planned, see [docs/design.md](docs/design.md)), Mac and Excel on the web, manifest validation against Microsoft's schema (`npx office-addin-manifest validate manifest.xml`), and numerical comparison with Ersatz itself.

## Layout

```
manifest.xml              Excel add-in manifest
src/engine/               Distributions, generators, formula compiler, run logic, thread pool. No Office dependency
src/functions/            Function registration and generated metadata
src/host/excel-host.js    All Office.js workbook calls
src/taskpane/             Interface, charts, HTML report and live window
tools/                    Local server, installer and metadata generators, simulated workbook, demo builder
tests/, benchmarks/       Test suites and timing scripts
docs/                     Design notes and provenance
```

## Credits

PSAkit is written and maintained by Fikru Rizal. It began as a prototype called "Surrogate". The function set is Jan Barendregt's design for Ersatz (EpiGear), implemented here from its public documentation.
