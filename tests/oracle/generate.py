# Builds a workbook, has LibreOffice calculate it, and saves the answers as an independent reference for the compiler.
# Run: python3 tests/oracle/generate.py  (needs openpyxl and LibreOffice). The result is committed as expected.json.
import json, os, shutil, subprocess, sys, tempfile
import openpyxl
from openpyxl.workbook.defined_name import DefinedName
here = os.path.dirname(os.path.abspath(__file__))
forms = json.load(open(os.path.join(here, 'formulas.json')))
layout = json.load(open(os.path.join(here, 'layout.json')))
wb = openpyxl.Workbook()
ws = wb.active; ws.title = 'S'
for addr, v in layout['S'].items(): ws[addr] = v
o = wb.create_sheet('Other')
for addr, v in layout['Other'].items(): o[addr] = v
wb.defined_names['rate'] = DefinedName('rate', attr_text='Other!$A$1')
wb.defined_names['table'] = DefinedName('table', attr_text='S!$F$1:$F$5')
r = wb.create_sheet('R')
PREFIX = {'STDEV.S','STDEV.P','VAR.S','VAR.P','PERCENTILE.INC','PERCENTILE.EXC','QUARTILE.INC','RANK.EQ','COVARIANCE.S','COVARIANCE.P','MAXIFS','MINIFS','IFS','SWITCH','XOR','IFNA','NORM.S.DIST','NORM.S.INV','NORM.DIST','NORM.INV','LOGNORM.DIST','LOGNORM.INV','EXPON.DIST','BINOM.DIST','POISSON.DIST','CONCAT'}
import re
def fix(f):
    for n in sorted(PREFIX, key=len, reverse=True):
        f = re.sub(r'(?<![A-Za-z_.])' + re.escape(n) + r'\(', '_xlfn.' + n + '(', f)
    return f
ARRAY = ('SUM(A1:A5*', 'MAX(A1:A5*', 'AVERAGE(A1:A5+')
for i, f in enumerate(forms):
    c = f'A{i+1}'
    text = '=' + fix(re.sub(r"(?<![!A-Za-z$.:])([A-Z]{1,2}\d+(?::[A-Z]{1,2}\d+)?)(?![A-Za-z0-9(])", r"S!\1", f))
    if f.startswith(ARRAY):
        r.formula_attributes = getattr(r, 'formula_attributes', {})
        from openpyxl.worksheet.formula import ArrayFormula
        r[c] = ArrayFormula(c, text)
    else:
        r[c] = text
tmp = tempfile.mkdtemp()
src = os.path.join(tmp, 'in.xlsx'); wb.save(src)
out = os.path.join(tmp, 'out'); os.makedirs(out)
subprocess.run(['soffice', '--headless', '--calc', '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', out, src], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
res = openpyxl.load_workbook(os.path.join(out, 'in.xlsx'), data_only=True)['R']
expected = {}
for i, f in enumerate(forms):
    v = res[f'A{i+1}'].value
    expected[f] = '' if v is None else v
json.dump(expected, open(os.path.join(here, 'expected.json'), 'w'), indent=0)
shutil.rmtree(tmp)
print(len(expected), 'reference answers;', sum(1 for v in expected.values() if isinstance(v, str) and v.startswith('#')), 'errors')
