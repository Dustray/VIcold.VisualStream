@echo off
setlocal EnableExtensions DisableDelayedExpansion

pushd "%~dp0"
if errorlevel 1 goto directory_error

where node.exe >nul 2>nul
if errorlevel 1 goto node_error
where npm.cmd >nul 2>nul
if errorlevel 1 goto node_error
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)"
if errorlevel 1 goto node_error

if not exist "node_modules\.bin\vite.cmd" (
  echo [VisualStream] Installing dependencies...
  if exist "package-lock.json" (
    call npm.cmd ci
  ) else (
    call npm.cmd install
  )
  if errorlevel 1 goto failed
)

echo [VisualStream] Preparing Perfetto engine...
call npm.cmd run setup:assets
if errorlevel 1 goto failed

echo.
echo [VisualStream] Starting http://127.0.0.1:5173
echo [VisualStream] Keep this window open. Press Ctrl+C to stop.
echo.
call npm.cmd run dev -- --open
if errorlevel 1 goto failed

popd
exit /b 0

:node_error
echo.
echo [VisualStream] Node.js 22.12 or newer and npm are required.
echo [VisualStream] Install Node.js, then reopen this script.
goto failed

:failed
echo.
echo [VisualStream] Startup failed. Check the message above and try again.
echo [VisualStream] The first setup requires an Internet connection.
pause
popd
exit /b 1

:directory_error
echo [VisualStream] Cannot open the project directory.
pause
exit /b 1
