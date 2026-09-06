@echo off
rem Desk launcher, written by tracker.py init. Double-click, or:
rem   desk            start (builds first if there is no executable yet)
rem   desk build      rebuild, then start
rem   desk shortcut   put the desk on the Desktop and in the Start Menu
rem   desk mcp        run the MCP server over stdio (what .mcp.json launches); builds it if missing
setlocal
set ROOT=%~dp0
set DESK=%ROOT%{{desk}}
set EXE=%DESK%\src-tauri\target\release\desk.exe
set MCP=%DESK%\src-tauri\target\release\desk-mcp.exe

if /i "%~1"=="shortcut" goto :shortcut
if /i "%~1"=="mcp" goto :mcp
if /i "%~1"=="build" goto :build
if not exist "%EXE%" goto :build
goto :start

:build
echo Building the desk (first time takes a few minutes)...
pushd "%DESK%" || exit /b 1
if not exist node_modules call pnpm install || (popd & exit /b 1)
call cargo tauri build --no-bundle || (popd & echo Build failed. & pause & exit /b 1)
popd
goto :start

:start
if not exist "%EXE%" (echo No executable at %EXE% & pause & exit /b 1)
cd /d "%ROOT%"
start "" "%EXE%"
exit /b 0

:mcp
rem Nothing may reach stdout except the server: the MCP transport is that stream.
cd /d "%ROOT%"
if not exist "%MCP%" (
  pushd "%DESK%"
  if not exist node_modules call pnpm install >nul 2>&1
  if not exist "%ROOT%Saved\Desk" mkdir "%ROOT%Saved\Desk"
  call cargo tauri build --no-bundle > "%ROOT%Saved\Desk\mcp-build.log" 2>&1
  popd
)
"%MCP%"
exit /b %ERRORLEVEL%

:shortcut
if not exist "%EXE%" call :build
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=New-Object -ComObject WScript.Shell;" ^
  "foreach($dir in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))){" ^
  "  $lnk=$s.CreateShortcut((Join-Path $dir 'Desk.lnk'));" ^
  "  $lnk.TargetPath='%EXE%'; $lnk.WorkingDirectory='%ROOT%'; $lnk.IconLocation='%EXE%,0';" ^
  "  $lnk.Description='The desk over docs/tracker'; $lnk.Save(); Write-Host ('created ' + $lnk.FullName) }"
exit /b 0
