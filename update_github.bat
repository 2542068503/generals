@echo off
git add .
set /p msg="Enter commit message (or press enter for default 'Update'): "
if "%msg%"=="" set msg=Update
git commit -m "%msg%"

echo.
echo Pulling latest changes from remote...
git pull --rebase
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Pull failed! There might be conflicts. Please resolve them manually.
    pause
    exit /b
)

echo.
echo Pushing changes to remote...
git push
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Push failed!
) else (
    echo.
    echo Update completed successfully!
)
pause
