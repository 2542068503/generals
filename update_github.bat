@echo off
git add .
set /p msg="Enter commit message (or press enter for default 'Update'): "
if "%msg%"=="" set msg=Update
git commit -m "%msg%"
git push
echo Update completed!
pause
