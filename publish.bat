@echo off
cd /d "%~dp0"

echo --- Updating version (patch) ---
npm version patch
IF %ERRORLEVEL% NEQ 0 (
    echo Error: npm version failed.
    pause
    exit /b %ERRORLEVEL%
)

REM Allow git commit/tag operations to finish
timeout /t 2 >nul

echo --- Publishing package ---
npm publish --access public
IF %ERRORLEVEL% NEQ 0 (
    echo Error: npm publish failed.
    pause
    exit /b %ERRORLEVEL%
)

echo --- Publish completed successfully ---
pause
