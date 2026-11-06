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
where cargo.exe >nul 2>nul
if errorlevel 1 goto rust_error

if not exist "node_modules\.bin\tauri.cmd" (
  echo [VisualStream] Installing dependencies...
  if exist "package-lock.json" (
    call npm.cmd ci
  ) else (
    call npm.cmd install
  )
  if errorlevel 1 goto failed
)

echo [VisualStream] Starting the desktop app...
echo [VisualStream] Keep this window open. Press Ctrl+C to stop.
call npm.cmd run desktop
if errorlevel 1 goto failed

popd
exit /b 0

:node_error
echo [VisualStream] Node.js 22.12 or newer and npm are required.
goto failed

:rust_error
echo [VisualStream] Rust and Visual Studio C++ Build Tools are required.
echo [VisualStream] See README.md for desktop setup instructions.
goto failed

:failed
echo.
echo [VisualStream] Desktop startup failed. Check the message above.
pause
popd
exit /b 1

:directory_error
echo [VisualStream] Cannot open the project directory.
pause
exit /b 1
