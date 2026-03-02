@echo off
cd /d "%~dp0"
echo Checking for changes...
git add .
git diff --cached --quiet
if %errorlevel%==0 (
    echo No changes. Already up to date!
    pause
    exit
)
echo Pushing to GitHub...
git commit -m "update"
git push origin main
echo.
echo Done! Site updated at oran-ops.github.io/xtix-crm
pause
