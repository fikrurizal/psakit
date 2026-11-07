@echo off
rem Installs the Surrogate add-in for Excel for the current Windows user. No admin rights needed.
rem It saves the manifest embedded at the end of this file to %LOCALAPPDATA%\Surrogate\manifest.xml
rem and registers it under HKCU\Software\Microsoft\Office\16.0\WEF\Developer.
rem Nothing else on the computer is changed. "Uninstall Surrogate.cmd" reverses it.
setlocal
title Install Surrogate
set "SG_SELF=%~f0"
set "SG_DIR=%LOCALAPPDATA%\Surrogate"
echo Installing the Surrogate add-in for Excel...
echo.
powershell -NoProfile -Command "$ErrorActionPreference = 'Stop'; $text = Get-Content -LiteralPath $env:SG_SELF -Raw; $parts = $text -split ('::SURROG'+'ATE-MANIFEST::'); if ($parts.Count -lt 2 -or -not $parts[1].Trim().StartsWith('<')) { Write-Host 'The installer file is damaged. Download it again.'; exit 1 }; $xml = $parts[1].Trim(); New-Item -ItemType Directory -Force -Path $env:SG_DIR | Out-Null; $m = Join-Path $env:SG_DIR 'manifest.xml'; Set-Content -LiteralPath $m -Value $xml -Encoding UTF8; $k = 'HKCU:\Software\Microsoft\Office\16.0\WEF\Developer'; if (-not (Test-Path $k)) { New-Item -Path $k | Out-Null }; New-ItemProperty -Path $k -Name '6f1d2c0a-8e57-4b7a-9a3e-2d4c1b7e9f10' -Value $m -PropertyType String -Force | Out-Null"
if errorlevel 1 goto failed
echo Surrogate is installed.
echo.
tasklist /fi "imagename eq EXCEL.EXE" 2>nul | find /i "EXCEL.EXE" >nul && (echo Excel is open. Close it completely first, then open it again.& echo.)
echo To start using it:
echo   1. Open Excel and any workbook.
echo   2. Go to Home ^> Add-ins. Under "Developer Add-ins", click Surrogate.
echo   3. From then on, Surrogate has its own button on the Data tab.
echo If the Surrogate panel stays on "Loading..." for more than a minute, close it with its X
echo and click the Surrogate button on the Data tab again.
echo.
echo To remove it, run "Uninstall Surrogate".
echo.
pause
exit /b 0
:failed
echo.
echo Surrogate could not be installed on this computer. The message above says why.
echo You can still use it in Excel on the web: Home ^> Add-ins ^> More Add-ins ^> Upload My Add-in.
echo Ask whoever sent you this installer for the manifest.xml file to upload there.
echo.
pause
exit /b 1

::SURROGATE-MANIFEST::
<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0"
           xmlns:ov="http://schemas.microsoft.com/office/taskpaneappversionoverrides"
           xsi:type="TaskPaneApp">
  <Id>6f1d2c0a-8e57-4b7a-9a3e-2d4c1b7e9f10</Id>
  <Version>1.0.0.0</Version>
  <ProviderName>Surrogate (unofficial)</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="Surrogate"/>
  <Description DefaultValue="Monte Carlo simulation, bootstrapping and microsimulation in Excel, with functions compatible with Ersatz formulas."/>
  <IconUrl DefaultValue="https://fikrurizal.github.io/surrogate/assets/icon-32.png"/>
  <HighResolutionIconUrl DefaultValue="https://fikrurizal.github.io/surrogate/assets/icon-64.png"/>
  <SupportUrl DefaultValue="https://fikrurizal.github.io/surrogate/README.md"/>
  <AppDomains>
    <AppDomain>https://appsforoffice.microsoft.com</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Workbook"/>
  </Hosts>
  <Requirements>
    <Sets DefaultMinVersion="1.1">
      <Set Name="SharedRuntime" MinVersion="1.1"/>
    </Sets>
  </Requirements>
  <DefaultSettings>
    <SourceLocation DefaultValue="https://fikrurizal.github.io/surrogate/src/taskpane/taskpane.html"/>
  </DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="VersionOverridesV1_0">
    <Hosts>
      <Host xsi:type="Workbook">
        <Runtimes>
          <Runtime resid="Taskpane.Url" lifetime="long"/>
        </Runtimes>
        <AllFormFactors>
          <ExtensionPoint xsi:type="CustomFunctions">
            <Script>
              <SourceLocation resid="Functions.Script.Url"/>
            </Script>
            <Page>
              <SourceLocation resid="Taskpane.Url"/>
            </Page>
            <Metadata>
              <SourceLocation resid="Functions.Metadata.Url"/>
            </Metadata>
            <Namespace resid="Functions.Namespace"/>
          </ExtensionPoint>
        </AllFormFactors>
        <DesktopFormFactor>
          <GetStarted>
            <Title resid="GetStarted.Title"/>
            <Description resid="GetStarted.Description"/>
            <LearnMoreUrl resid="GetStarted.LearnMore"/>
          </GetStarted>
          <FunctionFile resid="Taskpane.Url"/>
          <ExtensionPoint xsi:type="PrimaryCommandSurface">
            <OfficeTab id="TabData">
              <Group id="Surrogate.Group">
                <Label resid="Group.Label"/>
                <Icon>
                  <bt:Image size="16" resid="Icon.16"/>
                  <bt:Image size="32" resid="Icon.32"/>
                  <bt:Image size="80" resid="Icon.80"/>
                </Icon>
                <Control xsi:type="Button" id="Surrogate.Open">
                  <Label resid="Button.Label"/>
                  <Supertip>
                    <Title resid="Button.Label"/>
                    <Description resid="Button.Tip"/>
                  </Supertip>
                  <Icon>
                    <bt:Image size="16" resid="Icon.16"/>
                    <bt:Image size="32" resid="Icon.32"/>
                    <bt:Image size="80" resid="Icon.80"/>
                  </Icon>
                  <Action xsi:type="ShowTaskpane">
                    <TaskpaneId>SurrogatePane</TaskpaneId>
                    <SourceLocation resid="Taskpane.Url"/>
                  </Action>
                </Control>
              </Group>
            </OfficeTab>
          </ExtensionPoint>
        </DesktopFormFactor>
      </Host>
    </Hosts>
    <Resources>
      <bt:Images>
        <bt:Image id="Icon.16" DefaultValue="https://fikrurizal.github.io/surrogate/assets/icon-16.png"/>
        <bt:Image id="Icon.32" DefaultValue="https://fikrurizal.github.io/surrogate/assets/icon-32.png"/>
        <bt:Image id="Icon.80" DefaultValue="https://fikrurizal.github.io/surrogate/assets/icon-80.png"/>
      </bt:Images>
      <bt:Urls>
        <bt:Url id="Functions.Script.Url" DefaultValue="https://fikrurizal.github.io/surrogate/src/functions/functions.js"/>
        <bt:Url id="Functions.Metadata.Url" DefaultValue="https://fikrurizal.github.io/surrogate/src/functions/functions.json"/>
        <bt:Url id="Taskpane.Url" DefaultValue="https://fikrurizal.github.io/surrogate/src/taskpane/taskpane.html"/>
        <bt:Url id="GetStarted.LearnMore" DefaultValue="https://fikrurizal.github.io/surrogate/README.md"/>
      </bt:Urls>
      <bt:ShortStrings>
        <bt:String id="Functions.Namespace" DefaultValue="ER"/>
        <bt:String id="Group.Label" DefaultValue="Simulation"/>
        <bt:String id="Button.Label" DefaultValue="Surrogate"/>
        <bt:String id="GetStarted.Title" DefaultValue="Surrogate is ready"/>
      </bt:ShortStrings>
      <bt:LongStrings>
        <bt:String id="Button.Tip" DefaultValue="Open the simulation pane to run Monte Carlo models and view results."/>
        <bt:String id="GetStarted.Description" DefaultValue="Open Surrogate from the Data tab. Type =ER. in a cell to see the functions."/>
      </bt:LongStrings>
    </Resources>
  </VersionOverrides>
</OfficeApp>
