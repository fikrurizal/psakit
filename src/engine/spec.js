// Function catalogue: names, parameter order and categories as published in the Ersatz Function Overview.
// Param codes: n number, s text, b boolean, m range. Suffix ? marks optional.
(function (Sg) {
  const T = {
    ErBernoulli: 'Random draw from a Bernoulli distribution: 1 with probability p, else 0.',
    ErBeta: 'Random draw from a Beta distribution on 0..1.',
    ErBeta4: 'Random draw from a Beta distribution rescaled to min..max.',
    ErBinomial: 'Random draw from a Binomial distribution.',
    ErChi2: 'Random draw from a Chi-square distribution with k degrees of freedom.',
    ErDelaporte: 'Random draw from a Delaporte distribution: Poisson(Gamma(alpha,beta)) + Poisson(gamma).',
    ErDice: 'Random whole number from 1 to sides, inclusive.',
    ErErlang: 'Random draw from an Erlang distribution.',
    ErExponential: 'Random draw from an Exponential distribution with mean beta.',
    ErGamma: 'Random draw from a Gamma distribution with shape alpha and scale beta.',
    ErGeometric: 'Random draw from a Geometric distribution, counted from 0.',
    ErHypergeometric: 'Random draw from a Hypergeometric distribution.',
    ErInverseGaussian: 'Random draw from an Inverse Gaussian distribution.',
    ErLogistic: 'Random draw from a Logistic distribution.',
    ErLoglogistic: 'Random draw from a Log-logistic distribution.',
    ErLognormal: 'Random draw from a Lognormal distribution, given its own mean and SD.',
    ErLognormal2: 'Random draw from a Lognormal distribution, given mu and sigma of the log.',
    ErNegbinomial: 'Random draw from a Negative binomial distribution.',
    ErNormal: 'Random draw from a Normal distribution.',
    ErPareto: 'Random draw from a Pareto distribution.',
    ErPearson5: 'Random draw from a Pearson V distribution.',
    ErPearson6: 'Random draw from a Pearson VI distribution.',
    ErPert: 'Random draw from a Beta-Pert distribution with minimum a, mode m and maximum b.',
    ErPoisson: 'Random draw from a Poisson distribution.',
    ErPolya: 'Random draw from a Polya distribution: Poisson(Gamma(alpha,beta)).',
    ErRayleigh: 'Random draw from a Rayleigh distribution.',
    ErRelativeRisk: 'Random relative risk with lognormal spread, corrected so its mean equals RR.',
    ErStudentst: "Random draw from Student's t distribution.",
    ErTriangle: 'Random draw from a Triangular distribution.',
    ErUniform01: 'Random draw uniform between 0 and 1, exclusive.',
    ErUniform: 'Random draw uniform between min and max, exclusive.',
    ErWeibull: 'Random draw from a Weibull distribution. alpha is scale and beta is shape, the reverse of Excel.',
  };
  const S = [];
  const add = (cat, name, params, result, desc, opts) => S.push(Object.assign({ cat, name, params, result, desc }, opts));
  for (const [name, desc] of Object.entries(T)) add('Distribution', name, Sg.DISTS[name].params.map((p) => p + ':n'), 'n', desc, { random: true });
  add('Distribution', 'ErEmpirical', ['name:s', 'x:m', 'p:m', 'discrete:b'], 'n', 'Random draw from a distribution you define with x values and weights p.', { random: true });
  add('Distribution', 'ErSurvival', ['name:s', 'x:m', 'p:m', 'ct:n'], 'n', 'Random remaining survival time from conditional failure probabilities, given survival to time ct.', { random: true });
  add('Distribution', 'ErSurvival2', ['name:s', 'x:m', 'p:m', 'ct:n', 'rnd:n'], 'n', 'As ErSurvival, using your own uniform draw rnd, so two arms can share one draw.', { random: true });

  const pair = (m, mp, c, cp, md, cd) => {
    add('Component', m, mp, 's', md, { random: true });
    add('Component', c, cp, 'n', cd);
  };
  pair('ErNonparam', ['name:s', 'recnum:n', 'fieldnum:n'], 'ErNonparamCom', ['name:s', 'rec:n', 'field:n', 'val:n'], 'Master for non-parametric bootstrapping. Returns its name.', 'Bootstrapped value for one record and field. Link name to the ErNonparam cell.');
  pair('ErRandomise', ['name:s', 'recnum:n', 'fieldnum:n'], 'ErRandomiseCom', ['name:s', 'rec:n', 'field:n', 'val:n'], 'Master for a randomisation test. Returns its name.', 'Reshuffled value for one record and field. Link name to the ErRandomise cell.');
  pair('ErMultinomial', ['name:s', 'catnum:n', 'N:n'], 'ErMultinomialCom', ['name:s', 'cat:n', 'cases:n'], 'Master for a Multinomial distribution. Returns its name.', 'Multinomial draw for one category. Draws across categories sum to N.');
  pair('ErDirichlet', ['name:s', 'catnum:n', 'N:n'], 'ErDirichletCom', ['name:s', 'cat:n', 'cases:n'], 'Master for a Dirichlet distribution. Returns its name.', 'Dirichlet draw for one category. Draws across categories sum to 1.');
  pair('ErCorrNormal', ['name:s', 'C:m', 'n:n', 'corm:b'], 'ErCorrNormalCom', ['name:s', 'num:n', 'mu:n', 'sig:n'], 'Master for correlated Normals. C is a lower-triangle correlation or covariance matrix.', 'One correlated Normal draw. Link name to the ErCorrNormal cell.');
  pair('ErRankCorr', ['name:s', 'C:m', 'n:n'], 'ErRankCorrCom', ['name:s', 'num:n', 'func:n'], 'Master for rank-correlated distributions. C is a lower-triangle correlation matrix.', 'One rank-correlated draw. func must be an Ersatz random function embedded directly in this formula.');

  const corr = (base, label) => {
    add('Correlated multivariate', base, ['name:s', 'C:m', 'n:n'], 's', `Master for correlated ${label} distributions.`, { random: true });
    add('Correlated multivariate', base + 'In', ['name:s', 'inp:m', 'num:n'], 's', `Parameters of correlated ${label} distribution num.`);
    add('Correlated multivariate', base + 'Out', ['name:s', 'num:n'], 'm', `Draws for correlated ${label} distribution num. Spills across its categories.`);
  };
  corr('ErDirichletCorr', 'Dirichlet'); corr('ErMultinomialCorr', 'Multinomial');

  add('Output', 'ErOutput', ['name:s', 'value:n'], 'n', 'Records value on each iteration and reports it in the results. Returns value.');
  add('Output', 'ErRunOutput', ['name:s', 'value:n'], 'n', 'Records value once at the end of each run. Returns value.');
  add('Output', 'ErSensInput', ['name:s', 'value:n'], 'n', 'Names an input for sensitivity analysis. Returns value.');
  add('Output', 'ErRunSensInput', ['name:s', 'value:n'], 'n', 'Names an input for sensitivity analysis across runs. Returns value.');
  add('Output', 'ErData', ['inp:n', 'itnum:n'], 'n', 'After the run, returns the value inp had on iteration itnum. Returns 0 during the run.');
  add('Output', 'ErDataArray', ['name:s', 'innum:n'], 'm', 'After the run, spills innum from every iteration down a column.');
  add('Output', 'ErRunDataArray', ['name:s', 'value:n'], 'm', 'After all runs, spills value from the end of every run down a column.');

  add('Special', 'ErMinimize', ['name:s', 'ir:m'], 'm', 'Parameters being optimised, starting from range ir. Spills to the same shape as ir.');
  add('Special', 'ErMinimizeResult', ['name:s', 'lf:n'], 'n', 'Loss value the optimiser minimises. Must share its name with ErMinimize.');
  add('Special', 'ErOneOffCostDisc', ['by:n', 'cy:n', 'co:n', 'r:n'], 'n', 'Cost co at time cy, discounted to base year by at fractional rate r.');
  add('Special', 'ErAnnualCostDisc', ['by:n', 'sy:n', 'ly:n', 'co:n', 'r:n'], 'n', 'Annual cost co from sy to ly, discounted to base year by at fractional rate r.');
  add('Special', 'ErLYDisc', ['by:n', 'sy:n', 'ly:n', 'r:n'], 'n', 'Life years from sy to ly, discounted to base year by at fractional rate r.');
  add('Special', 'ErHALYDisc', ['by:n', 'sy:n', 'ly:n', 'r:n', 'ag:m', 'ha:m'], 'n', 'Health-adjusted life years from sy to ly, using weights ha by single year of age ag.');
  add('Special', 'ErFixed', ['x:m', 'num:n'], 'n', 'Returns element num of range x, wrapping around past the end.', { volatile: true });
  add('Special', 'ErConditional', ['con:b', 'value:n'], 'n', 'Returns value when con is TRUE. Otherwise holds the previous result.', { volatile: true });
  add('Special', 'ErTruncate', ['min:n', 'max:n', 'func:n'], 'n', 'Resamples an embedded random function until it falls between min and max.', { volatile: true });
  add('Special', 'ErIteration', [], 'n', 'Number of the current iteration.', { volatile: true });
  add('Special', 'ErSetItno', ['num:n'], 'n', 'Sets the number of iterations from the worksheet.');
  add('Special', 'ErRunno', [], 'n', 'Number of the current run.', { volatile: true });
  add('Special', 'ErRunning', [], 'b', 'TRUE while a simulation is running.', { volatile: true });
  add('Special', 'ErVersion', [], 's', 'Version of this add-in.');
  add('Special', 'ErStore', ['name:s', 'inp:n'], 's', 'Stores a number for the next iteration. Returns name.');
  add('Special', 'ErRetrieve', ['name:s'], 'n', 'Number stored by ErStore on the previous iteration. 0 on the first.', { volatile: true });
  add('Special', 'ErStoreArray', ['name:s', 'inarray:m'], 's', 'Stores a range for the next iteration. Returns name.');
  add('Special', 'ErRetrieveArray', ['name:s'], 'm', 'Range stored by ErStoreArray on the previous iteration.', { volatile: true });
  add('Special', 'ErCondStoreArray', ['name:s', 'condition:b', 'inarray:m', 'mode:n'], 's', 'Stores a range when condition is TRUE. mode 0 replaces, 1 multiplies, 2 adds.');
  add('Special', 'ErCondRetrieveArray', ['name:s', 'condition:b'], 'm', 'Range stored by ErCondStoreArray, updated when condition is TRUE.', { volatile: true });
  add('Special', 'ErSortedArray', ['inarray:m', 'mode:n'], 'm', 'Sorts a range. mode 1 is ascending, anything else descending.');

  for (const [n, d] of [['ErMean', 'mean'], ['ErStDev', 'standard deviation'], ['ErMin', 'lowest value'], ['ErMax', 'highest value'], ['ErTotal', 'sum']])
    add('Statistics', n, ['inp:n'], 'n', `At the end of a run, the ${d} of inp across its iterations.`);
  add('Statistics', 'ErCorrelation', ['X:n', 'Y:n'], 'n', 'At the end of a run, the Pearson correlation of X and Y across its iterations.');
  add('Statistics', 'ErPercentile', ['inp:n', 'perc:n'], 'n', 'At the end of a run, percentile perc (0 to 100) of inp across its iterations.');

  // Internal names (ErBeta) follow the Ersatz Function Overview, so the catalogue can be checked against it line by
  // line. Users see PSAkit's own names instead: the namespace plus the name without "Er" (ErBeta -> PSA.BETA).
  Sg.NAMESPACE = 'PSA';
  const RENAME = { ErChi2: 'CHISQ' }; // CHI2 on its own reads as a cell reference (column CHI, row 2)
  Sg.excelName = (name) => RENAME[name] || name.replace(/^Er/, '').toUpperCase();
  Sg.SPEC = S;
  Sg.SPEC_BY_NAME = Object.fromEntries(S.map((s) => [s.name, s]));
  Sg.SPEC_BY_EXCEL = new Map(S.map((s) => [Sg.excelName(s.name), s]));
  // Rewrites internal names in text meant for people: "ErCorrNormal" -> "PSA.CORRNORMAL".
  Sg.publicText = (text) => (typeof text === 'string' ? text.replace(/\bEr[A-Z][A-Za-z0-9]*\b/g, (m) => (Sg.SPEC_BY_NAME[m] ? `${Sg.NAMESPACE}.${Sg.excelName(m)}` : m)) : text);
  for (const s of S) s.desc = Sg.publicText(s.desc);
  Sg.VERSION = '0.1.0';
})(globalThis.Sg = globalThis.Sg || {});
