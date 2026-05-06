@echo off
setlocal

set "NODE_EXE="
if not "%NVM_SYMLINK%"=="" set "NODE_EXE=%NVM_SYMLINK%\node.exe"
if "%NODE_EXE%"=="" if exist "D:\Program\nodejs\node.exe" set "NODE_EXE=D:\Program\nodejs\node.exe"
set "VITE_CLI=%~dp0node_modules\vite\bin\vite.js"

if not exist "%NODE_EXE%" (
  echo node.exe not found. Checked NVM_SYMLINK and D:\Program\nodejs\node.exe
  exit /b 1
)

if not exist "%VITE_CLI%" (
  echo vite.js not found: %VITE_CLI%
  exit /b 1
)

"%NODE_EXE%" "%VITE_CLI%" %*
