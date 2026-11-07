// The example model behind "Insert example model": a two-arm cost-effectiveness model of a screening
// programme, using invented numbers. It exercises Beta, Gamma, RelativeRisk, Dirichlet and the discount functions.
(function (Sg) {
  Sg.EXAMPLE_NAME = 'Example model';
  Sg.EXAMPLE_ROWS = [
    ['Screening programme: illustrative cost-effectiveness model (all inputs are invented)', '', '', ''],
    ['', '', '', ''],
    ['Input', 'Draw', 'Distribution', 'Note'],
    ['Baseline risk of event', '=ER.ERBETA(120,880)', 'Beta', '120 events in 1,000 people'],
    ['Relative risk with screening', '=ER.ERRELATIVERISK(0.72,0.11)', 'Relative risk', 'SE of ln(RR) from the trial'],
    ['Cost of care per event ($)', '=ER.ERGAMMA(25,1200)', 'Gamma', 'Mean 30,000'],
    ['Screening cost per person ($)', '=ER.ERLOGNORMAL(180,35)', 'Lognormal', 'Mean 180, SD 35'],
    ['Life years lost per event', '=ER.ERPERT(4,7,13)', 'Pert', 'Expert range'],
    ['Master for severity split', '=ER.ERDIRICHLET("severity",3,200)', 'Dirichlet', '200 cases in the audit'],
    ['Share mild', '=ER.ERDIRICHLETCOM(B9,1,110)', 'Dirichlet', ''],
    ['Share moderate', '=ER.ERDIRICHLETCOM(B9,2,65)', 'Dirichlet', ''],
    ['Share severe', '=ER.ERDIRICHLETCOM(B9,3,25)', 'Dirichlet', ''],
    ['Quality weight lost, severity-adjusted', '=B10*0.05+B11*0.2+B12*0.45', 'Calculated', ''],
    ['Discount rate', 0.03, 'Fixed', 'Vary this by hand; it is not sampling error'],
    ['', '', '', ''],
    ['Result per person', 'Value', '', ''],
    ['Events avoided', '=B4*(1-B5)', '', ''],
    ['Discounted life years per event', '=ER.ERLYDISC(0,0,B8,B14)', '', ''],
    ['QALYs gained', '=B17*B18*(1-B13)', '', ''],
    ['Net cost ($)', '=B7-B17*B6', '', ''],
    ['', '', '', ''],
    ['Outputs', 'Value', '', ''],
    ['QALYs gained', '=ER.EROUTPUT("QALYs gained",B19)', '', ''],
    ['Net cost', '=ER.EROUTPUT("Net cost",B20)', '', ''],
    ['Net monetary benefit at $50,000', '=ER.EROUTPUT("Net benefit at $50k",50000*B19-B20)', '', ''],
  ];
})(globalThis.Sg = globalThis.Sg || {});
