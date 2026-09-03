@echo off
setlocal
cd /d "%~dp0.."
set DHS_HEADED=0
node ".\src\post-dhs.js"
set EXITCODE=%ERRORLEVEL%
if not %EXITCODE%==0 (
  echo DHS post failed with exit code %EXITCODE%
)
exit /b %EXITCODE%
