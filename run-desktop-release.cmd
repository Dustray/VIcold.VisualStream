@echo off
setlocal EnableExtensions DisableDelayedExpansion

pushd "%~dp0"
if errorlevel 1 goto directory_error

if /i "%~1"=="--no-build" goto launch
if not "%~1"=="" goto usage_error

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

echo [VisualStream] Building the Release desktop app. This may take several minutes...
call npm.cmd run desktop:build -- --no-bundle
if errorlevel 1 goto failed

:launch
if not exist "src-tauri\target\release\visualstream.exe" goto missing_release
echo [VisualStream] Starting the Release desktop app...
start "" "%~dp0src-tauri\target\release\visualstream.exe"
if errorlevel 1 goto failed

popd
exit /b 0

:node_error
echo [VisualStream] Node.js 22.12 or newer and npm are required to build.
goto failed

:rust_error
echo [VisualStream] Rust and Visual Studio C++ Build Tools are required to build.
echo [VisualStream] See README.md for desktop setup instructions.
goto failed

:missing_release
echo [VisualStream] Release app not found. Run this script without --no-build first.
goto failed

:usage_error
echo [VisualStream] Usage: run-desktop-release.cmd [--no-build]
goto failed

:failed
echo.
echo [VisualStream] Release startup failed. Check the message above.
echo [VisualStream] If the Release app is running, close it before rebuilding.
pause
popd
exit /b 1

:directory_error
echo [VisualStream] Cannot open the project directory.
pause
exit /b 1
