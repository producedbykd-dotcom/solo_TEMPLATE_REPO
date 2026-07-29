@echo off
setlocal

REM build-solo.bat — Build the Release Engine Solo Edition template on Windows.
REM Double-click this file from the project root, or right-click → Run as administrator.

REM Make sure we are running from this file's folder (the project root),
REM even if the user double-clicked it from another directory.
cd /d "%~dp0"

if not exist "scripts\build-solo.mjs" (
  echo.
  echo  Error: scripts\build-solo.mjs not found.
  echo.
  echo  This batch file must be run from the Release Engine project root
  echo  folder — the same folder that contains package.json.
  echo.
  pause
  exit /b 1
)

echo.
echo  Building Release Engine Solo Edition template...
echo  Output folder: ..\release-engine-solo-template
echo.

node scripts\build-solo.mjs --out ..\release-engine-solo-template

if %errorlevel% neq 0 (
  echo.
  echo  Build failed with error %errorlevel%.
) else (
  echo.
  echo  Build complete. Push the contents of ..\release-engine-solo-template
  echo  to your private GitHub template repository when you are ready.
)

pause
endlocal
