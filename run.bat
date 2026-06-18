@echo off
REM Chess Trainer · Modo Local - Windows Launcher

echo.
echo ====================================
echo Chess Trainer - Modo Local (Windows)
echo ====================================
echo.

REM Crear entorno virtual si no existe
if not exist venv (
    echo Creando entorno virtual...
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: No se pudo crear el entorno virtual
        pause
        exit /b 1
    )
)

REM Activar entorno virtual
echo Activando entorno virtual...
call venv\Scripts\activate.bat

REM Instalar dependencias
echo Instalando dependencias...
pip install -r requirements.txt 
if errorlevel 1 (
    echo ERROR: No se pudieron instalar las dependencias
    pause
    exit /b 1
)

REM ===============================
REM STOCKFISH AUTO-INSTALL
REM ===============================

set STOCKFISH_DIR=stockfish
set STOCKFISH_EXE=%STOCKFISH_DIR%\stockfish.exe

if not exist %STOCKFISH_EXE% (
    echo.
    echo Stockfish no encontrado. Descargando...

    if not exist %STOCKFISH_DIR% mkdir %STOCKFISH_DIR%

    powershell -Command ^
    "Invoke-WebRequest -Uri 'https://stockfishchess.org/files/stockfish_16.1_win_x64_avx2.zip' -OutFile 'stockfish.zip'"

    echo Descomprimiendo Stockfish...

    powershell -Command ^
    "Expand-Archive -Path 'stockfish.zip' -DestinationPath '%STOCKFISH_DIR%' -Force"

    del stockfish.zip

    REM Mover exe si está dentro de subcarpeta
    for /r %STOCKFISH_DIR% %%i in (*.exe) do (
        copy "%%i" "%STOCKFISH_EXE%" >nul
    )

    echo Stockfish instalado correctamente.
) else (
    echo Stockfish ya está instalado.
)

echo.
echo ====================================
echo Iniciando servidor...
echo Abre http://localhost:8000 en tu navegador
echo ====================================
echo.

python main.py

pause