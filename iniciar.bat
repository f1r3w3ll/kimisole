@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ============================================
echo  kimiSole - Iniciando servidor Web UI
echo ============================================
echo.

if not exist ".venv\Scripts\python.exe" (
    echo ERRO: Ambiente virtual nao encontrado em .venv\Scripts\python.exe
    echo.
    pause
    exit /b 1
)

echo Iniciando servidor em http://127.0.0.1:8765
echo Nao feche esta janela enquanto usar a aplicacao.
echo.

.venv\Scripts\python.exe app.py

echo.
echo Servidor encerrado.
pause
