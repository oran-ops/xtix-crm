@echo off
echo Checking for changes...
git add -A
git diff --cached --quiet && echo No changes to push. && pause && exit /b 0
git commit -m "dev: update %date% %time%"
echo Pushing to DEV branch...
git push origin dev
echo.
echo Done! DEV updated at oran-ops.github.io/xtix-crm (dev branch)
pause
