@echo off
cd /d "%~dp0"

echo --- Updating version (patch) ---
cmd /c "npm version patch"

REM Force reset ERRORLEVEL because git hooks cause false errors
set ERRORLEVEL=0

REM Add small delay for git tagging to finish
timeout /t 1 >nul

echo --- Publishing package ---
npm publish --access public
IF %ERRORLEVEL% NEQ 0 (
    echo Error: npm publish failed.
    pause
    exit /b %ERRORLEVEL%
)

echo --- Publish completed successfully ---
pause
