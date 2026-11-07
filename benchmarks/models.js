// Benchmark models shaped like the two slow examples in the Ersatz User Guide. The real workbooks ship with Ersatz and
// aren't reproduced here, so these are stand-ins of a stated size with invented numbers.
function life(n, f) { const o = {}; for (let i = 0; i < n; i++) { o[`J${i + 1}`] = i; o[`K${i + 1}`] = f(i); } return o; }
// Population model, like BreastCaMarkovMC: one iteration per age group, 2000 runs, effect size drawn once per run.
function markov(ageGroups = 14, years = 100) {
  const c = { F17: ageGroups, F21: '=ER.ERSETITNO(F17)', F19: '=ER.ERITERATION()', F23: '=F19=1',
    L4: '=ER.ERCONDITIONAL(F23,ER.ERRELATIVERISK(0.55,0.15))', L9: '=ER.ERCONDITIONAL(F23,ER.ERGAMMA(25,1600))', L10: 0.03 };
  Object.assign(c, life(120, (i) => Math.min(1, 0.0005 * Math.exp(0.085 * i))));
  for (let g = 0; g < ageGroups; g++) { c[`Q${g + 1}`] = 20 + g * 5; c[`R${g + 1}`] = 100 + g * 40; }
  c.F20 = '=INDEX(Q1:Q14,F19)'; c.F24 = '=INDEX(R1:R14,F19)';
  for (let t = 1; t <= years; t++) {
    const r = t + 1, p = t;
    c[`A${r}`] = t === 1 ? '=F20' : `=A${p}+1`;
    c[`B${r}`] = `=INDEX(K1:K120,MIN(A${r}+1,120))`;
    c[`C${r}`] = `=0.08*EXP(-0.09*${t})`;
    c[`D${r}`] = t <= 5 ? `=C${r}*L4` : `=C${r}*(L4+(1-L4)*MIN(1,(${t}-5)/10))`;
    c[`E${r}`] = t === 1 ? '=F24' : `=E${p}*(1-B${p})*(1-C${p})`;
    c[`G${r}`] = t === 1 ? '=F24' : `=G${p}*(1-B${p})*(1-D${p})`;
    c[`H${r}`] = `=(1+L10)^-${t - 1}`;
    c[`I${r}`] = `=(G${r}-E${r})*H${r}`;
    c[`L${r + 20}`] = `=(E${r}*C${r}-G${r}*D${r})*L9*H${r}`;
    c[`M${r + 20}`] = t <= 5 ? `=G${r}*30000*H${r}` : '=0';
  }
  const last = years + 1;
  c.S1 = `=SUM(I2:I${last})`;
  c.S2 = `=SUM(M22:M${last + 20})-SUM(L22:L${last + 20})`;
  c.T1 = '=ER.ERTOTAL(S1)'; c.T2 = '=ER.ERTOTAL(S2)'; c.T3 = '=IF(T1>0,T2/T1,0)';
  c.U1 = '=ER.ERRUNOUTPUT("LY gained",T1)'; c.U2 = '=ER.ERRUNOUTPUT("Extra cost",T2)'; c.U3 = '=ER.ERRUNOUTPUT("ICER",T3)';
  c.V1 = '=ER.ERRUNSENSINPUT("Effect",L4)'; c.V2 = '=ER.ERRUNSENSINPUT("Cost",L9)';
  return c;
}
// Individual model, like BreastCaMicroUnc: one iteration per woman, 2000 runs, effect drawn once per run.
function micro() {
  const c = { F1: 2448, F2: '=ER.ERSETITNO(F1)', F3: '=ER.ERITERATION()',
    L4: '=ER.ERCONDITIONAL(F3=1,ER.ERRELATIVERISK(0.55,0.15))', L9: '=ER.ERCONDITIONAL(F3=1,ER.ERGAMMA(25,1600))' };
  Object.assign(c, life(100, (i) => Math.min(0.6, 0.0005 * Math.exp(0.085 * i))));
  for (let i = 0; i < 40; i++) { c[`P${i + 1}`] = i; c[`Q${i + 1}`] = 0.08 * Math.exp(-0.09 * i); c[`R${i + 1}`] = `=Q${i + 1}*L4`; }
  c.A1 = '=20+ER.ERWEIBULL(45,4)'; c.A2 = '=MIN(A1,99)';
  c.A3 = '=A2+ER.ERSURVIVAL("other",J1:J100,K1:K100,A2)';
  c.A4 = '=ER.ERUNIFORM01()';
  c.A5 = '=ER.ERSURVIVAL2("base",P1:P40,Q1:Q40,0,A4)'; c.A6 = '=ER.ERSURVIVAL2("rx",P1:P40,R1:R40,0,A4)';
  c.A7 = '=IF(A5>=40,A3,MIN(A3,A2+A5))'; c.A8 = '=IF(A6>=40,A3,MIN(A3,A2+A6))';
  c.A9 = '=A8-A7'; c.A10 = '=ER.ERLYDISC(A2,A2,A8,0.03)-ER.ERLYDISC(A2,A2,A7,0.03)'; c.A11 = '=30000+L9*IF(A8<A3,1,0)-L9*IF(A7<A3,1,0)';
  c.T1 = '=ER.ERMEAN(A10)'; c.T2 = '=ER.ERMEAN(A11)'; c.T3 = '=IF(T1>0,T2/T1,0)';
  c.U1 = '=ER.ERRUNOUTPUT("LY gained",T1)'; c.U2 = '=ER.ERRUNOUTPUT("Cost",T2)'; c.U3 = '=ER.ERRUNOUTPUT("ICER",T3)';
  c.V1 = '=ER.ERRUNSENSINPUT("Effect",L4)';
  return c;
}
// Plain uncertainty analysis, with no state tying iterations together.
function psa(extraRows = 200) {
  const c = { A1: '=ER.ERBETA(120,880)', A2: '=ER.ERRELATIVERISK(0.72,0.11)', A3: '=ER.ERGAMMA(25,1200)', A4: '=ER.ERLOGNORMAL(180,35)', A5: '=ER.ERPERT(4,7,13)', A6: 0.03 };
  for (let i = 1; i <= extraRows; i++) {
    c[`C${i}`] = i === 1 ? '=A1' : `=C${i - 1}*(1-A1*0.01)`;
    c[`D${i}`] = `=C${i}*(1-A2)*(1+A6)^-${i}`;
    c[`E${i}`] = `=D${i}*A3-A4/${i}`;
  }
  c.F1 = `=SUM(D1:D${extraRows})*A5`; c.F2 = `=SUM(E1:E${extraRows})`;
  c.G1 = '=ER.EROUTPUT("Effect",F1)'; c.G2 = '=ER.EROUTPUT("Net cost",F2)'; c.G3 = '=ER.EROUTPUT("NMB",50000*F1+F2)';
  return c;
}
module.exports = { markov, micro, psa };
