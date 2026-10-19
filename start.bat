@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Нарезачка

if not exist ".env" (
  if exist ".env.example" copy /y ".env.example" ".env" >nul
)

if exist ".env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="FFMPEG_PATH" set "FFMPEG_PATH=%%B"
    if /i "%%A"=="FFPROBE_PATH" set "FFPROBE_PATH=%%B"
    if /i "%%A"=="YTDLP_PATH" set "YTDLP_PATH=%%B"
  )
)

if defined FFMPEG_PATH (
  for %%I in ("%FFMPEG_PATH%") do set "PATH=%%~dpI;!PATH!"
)
if defined YTDLP_PATH (
  for %%I in ("%YTDLP_PATH%") do set "PATH=%%~dpI;!PATH!"
)

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js не найден. Установите Node 20+.
  pause
  exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
  echo Python не найден. Установите Python 3.11+.
  pause
  exit /b 1
)

if not exist "node_modules\@narezchik\shared\src\index.ts" (
  echo Ставлю npm зависимости...
  call npm install
  if errorlevel 1 (
    echo npm install не удался.
    pause
    exit /b 1
  )
)

echo Запускаю веб, API, воркер нарезки и студию...
echo Интерфейс: http://localhost:5173
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:5173"
call npm run dev
pause
