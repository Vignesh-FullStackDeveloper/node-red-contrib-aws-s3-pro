@echo off
echo --- Updating version (patch) ---
npm version patch
IF %ERRORLEVEL% NEQ 0 (
    echo Error: npm version failed.
    exit /b %ERRORLEVEL%
)

echo --- Publishing package ---
npm publish --access public
IF %ERRORLEVEL% NEQ 0 (
    echo Error: npm publish failed.
    exit /b %ERRORLEVEL%
)

echo --- Publish completed successfully ---
pause
