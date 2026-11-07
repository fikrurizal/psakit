// Builds the one-file Windows installer and uninstaller from manifest.xml:
//   dist/Install Surrogate.cmd    copies the manifest to %LOCALAPPDATA%\Surrogate and registers it with Excel
//   dist/Uninstall Surrogate.cmd  removes both
// Both work per user, need no admin rights, and use only built-in PowerShell cmdlets, so they also run where
// PowerShell is limited to Constrained Language Mode. Run "npm run set-host -- https://..." first, so the
// embedded manifest points at the hosted files rather than https://localhost:3000.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const manifest = fs.readFileSync(path.join(root, 'manifest.xml'), 'utf8').replace(/^﻿/, '').trim();
const id = (manifest.match(/<Id>([0-9a-fA-F-]{36})<\/Id>/) || [])[1];
const version = (manifest.match(/<Version>([^<]+)<\/Version>/) || [])[1];
if (!id) { console.error('Could not find the add-in <Id> in manifest.xml.'); process.exit(1); }
const host = (manifest.match(/SourceLocation DefaultValue="(https:\/\/[^"]+?)\/src\//) || [])[1] || '?';

const KEY = 'HKCU:\\Software\\Microsoft\\Office\\16.0\\WEF\\Developer';
// The marker is split in the command so that the command line itself doesn't contain it.
const MARK = '::SURROGATE-MANIFEST::';
const markExpr = `('${MARK.slice(0, 8)}'+'${MARK.slice(8)}')`;

const install = [
  '@echo off',
  'rem Installs the Surrogate add-in for Excel for the current Windows user. No admin rights needed.',
  'rem It saves the manifest embedded at the end of this file to %LOCALAPPDATA%\\Surrogate\\manifest.xml',
  `rem and registers it under ${KEY.replace(':', '')}.`,
  'rem Nothing else on the computer is changed. "Uninstall Surrogate.cmd" reverses it.',
  'setlocal',
  'title Install Surrogate',
  'set "SG_SELF=%~f0"',
  'set "SG_DIR=%LOCALAPPDATA%\\Surrogate"',
  'echo Installing the Surrogate add-in for Excel...',
  'echo.',
  'powershell -NoProfile -Command "$ErrorActionPreference = \'Stop\';' +
    ` $text = Get-Content -LiteralPath $env:SG_SELF -Raw; $parts = $text -split ${markExpr};` +
    ' if ($parts.Count -lt 2 -or -not $parts[1].Trim().StartsWith(\'<\')) { Write-Host \'The installer file is damaged. Download it again.\'; exit 1 };' +
    ' $xml = $parts[1].Trim();' +
    ' New-Item -ItemType Directory -Force -Path $env:SG_DIR | Out-Null;' +
    ' $m = Join-Path $env:SG_DIR \'manifest.xml\'; Set-Content -LiteralPath $m -Value $xml -Encoding UTF8;' +
    ` $k = '${KEY}'; if (-not (Test-Path $k)) { New-Item -Path $k | Out-Null };` +
    ` New-ItemProperty -Path $k -Name '${id}' -Value $m -PropertyType String -Force | Out-Null"`,
  'if errorlevel 1 goto failed',
  'echo Surrogate is installed.',
  'echo.',
  'tasklist /fi "imagename eq EXCEL.EXE" 2>nul | find /i "EXCEL.EXE" >nul && (echo Excel is open. Close it completely first, then open it again.& echo.)',
  'echo To start using it:',
  'echo   1. Open Excel and any workbook.',
  'echo   2. Go to Home ^> Add-ins. Under "Developer Add-ins", click Surrogate.',
  'echo   3. From then on, Surrogate has its own button on the Data tab.',
  'echo If the Surrogate panel stays on "Loading..." for more than a minute, close it with its X',
  'echo and click the Surrogate button on the Data tab again.',
  'echo.',
  'echo To remove it, run "Uninstall Surrogate".',
  'echo.',
  'pause',
  'exit /b 0',
  ':failed',
  'echo.',
  'echo Surrogate could not be installed on this computer. The message above says why.',
  'echo You can still use it in Excel on the web: Home ^> Add-ins ^> More Add-ins ^> Upload My Add-in.',
  'echo Ask whoever sent you this installer for the manifest.xml file to upload there.',
  'echo.',
  'pause',
  'exit /b 1',
  '',
  MARK,
  manifest.replace(/\r?\n/g, '\r\n'), // cmd misreads goto labels in files with mixed line endings
  '',
].join('\r\n');

const uninstall = [
  '@echo off',
  'rem Removes the Surrogate add-in for the current Windows user: the registry entry and %LOCALAPPDATA%\\Surrogate.',
  'setlocal',
  'title Uninstall Surrogate',
  'set "SG_DIR=%LOCALAPPDATA%\\Surrogate"',
  'powershell -NoProfile -Command "$ErrorActionPreference = \'Stop\';' +
    ` $k = '${KEY}'; if (Test-Path $k) { Remove-ItemProperty -Path $k -Name '${id}' -ErrorAction SilentlyContinue };` +
    ' if (Test-Path -LiteralPath $env:SG_DIR) { Remove-Item -LiteralPath $env:SG_DIR -Recurse -Force }"',
  'if errorlevel 1 (echo Surrogate could not be fully removed. The message above says why.& echo.& pause& exit /b 1)',
  'echo Surrogate has been removed. Close and reopen Excel to finish.',
  'echo.',
  'pause',
  '',
].join('\r\n');

const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'Install Surrogate.cmd'), install);
fs.writeFileSync(path.join(out, 'Uninstall Surrogate.cmd'), uninstall);
console.log(`Wrote dist/Install Surrogate.cmd and dist/Uninstall Surrogate.cmd (add-in ${id}, version ${version}).`);
console.log(`The add-in loads from ${host}.`);
if (/localhost/i.test(host)) console.log('Note: that is this computer. Users would need "npm start" running. Run "npm run set-host -- https://..." first to build installers for others.');
