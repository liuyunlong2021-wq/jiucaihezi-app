@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PY=%~dp0.venv\Scripts\python.exe"

if not exist "%PY%" (
    echo [i] 未找到虚拟环境，正在创建 .venv ...
    where python >nul 2>nul
    if errorlevel 1 (
        echo [x] 系统 PATH 里没有 python，请改用:
        echo     "D:\Comfy-Desktop\ComfyUI-Installs\ComfyUI\standalone-env\python.exe" -m venv .venv
        exit /b 1
    )
    python -m venv .venv || exit /b 1
    "%PY%" -m pip install --upgrade pip
    "%PY%" -m pip install -r requirements.txt || exit /b 1
)

if /i "%~1"=="check" (
    "%PY%" app.py --check
    exit /b %errorlevel%
)

if /i "%~1"=="models" (
    "%PY%" app.py --list-models
    exit /b %errorlevel%
)

echo ================================================================
echo  comfy-adapter  ^|  http://127.0.0.1:9000
echo  Ctrl+C 停止
echo ================================================================
"%PY%" app.py %*
