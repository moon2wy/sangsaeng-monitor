@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 상생 모아 수집기
where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 버전을 설치하세요.
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 (
  echo [오류] Node.js 24 이상이 필요합니다. https://nodejs.org 에서 LTS 버전을 설치하세요.
  pause
  exit /b 1
)
where git >nul 2>nul
if errorlevel 1 (
  echo [오류] Git이 설치되어 있지 않습니다. https://git-scm.com/download/win 에서 설치하세요.
  pause
  exit /b 1
)
echo 상생 모아 수집기를 시작합니다. 이 창을 닫으면 수집이 멈춥니다. 최소화해 두세요.
echo.
node --disable-warning=ExperimentalWarning collector\run.mjs
pause
