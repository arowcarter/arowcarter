@echo off
setlocal
set DOTNET_CLI_TELEMETRY_OPTOUT=1
if not defined GAME_VERSION set GAME_VERSION=1.4.0
cd /d "%~dp0"

dotnet tool restore
if errorlevel 1 exit /b %errorlevel%

dotnet wix extension add WixToolset.UI.wixext/5.0.2
if errorlevel 1 exit /b %errorlevel%

dotnet publish TacticalMapWarGame.csproj -c Release -r win-x64 --self-contained true -p:Version=%GAME_VERSION% -o "%~dp0dist\publish"
if errorlevel 1 exit /b %errorlevel%

dotnet wix build installer.wxs -ext WixToolset.UI.wixext -arch x64 -o "%~dp0dist\TacticalMapWarGameSetup.msi"
if errorlevel 1 exit /b %errorlevel%

dotnet wix msi validate "%~dp0dist\TacticalMapWarGameSetup.msi"
if errorlevel 1 exit /b %errorlevel%

echo Installer: %~dp0dist\TacticalMapWarGameSetup.msi
