@echo off
REM Chess Trainer · Modo Local - Windows Launcher

echo.
echo ====================================
echo Chess Trainer - Modo Local (Windows)
echo ====================================
echo.

REM ===============================
REM 1. ENTORNO VIRTUAL
REM ===============================
if not exist venv (
    echo Creando entorno virtual...
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: No se pudo crear el entorno virtual
        pause
        exit /b 1
    )
)

echo Activando entorno virtual...
call venv\Scripts\activate.bat

REM ===============================
REM 2. DEPENDENCIAS
REM ===============================
echo Instalando dependencias...
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Fallo instalando dependencias
    pause
    exit /b 1
)

REM ===============================
REM 3. STOCKFISH AUTO (ROBUSTO)
REM ===============================

set STOCKFISH_EXE=stockfish.exe
set STOCKFISH_DIR=stockfish
set STOCKFISH_ZIP=stockfish.zip

echo.
echo [1/5] Verificando Stockfish...

REM -------------------------------
REM CASO 1: EXE EN RAÍZ
REM -------------------------------
if exist %STOCKFISH_EXE% (
    echo OK: Stockfish encontrado en raiz.
    goto STOCKFISH_DONE
)

REM -------------------------------
REM CASO 2: CARPETA EXISTE
REM -------------------------------
if exist %STOCKFISH_DIR%\ (
    echo Carpeta stockfish detectada. Buscando ejecutable...

    for /r %STOCKFISH_DIR% %%i in (*.exe) do (
        echo Copiando %%i a raiz...
        copy /Y "%%i" "%STOCKFISH_EXE%" >nul
        goto STOCKFISH_DONE
    )

    echo No se encontro exe en la carpeta stockfish.
)

REM -------------------------------
REM CASO 3: DESCARGAR
REM -------------------------------
echo [2/5] Stockfish no encontrado. Descargando...

if exist %STOCKFISH_ZIP% del /q %STOCKFISH_ZIP%
if exist %STOCKFISH_DIR% rd /s /q %STOCKFISH_DIR%

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
"Invoke-WebRequest -Uri 'https://github.com/official-stockfish/Stockfish/releases/latest/download/stockfish-windows-x86-64-avx2.zip' -OutFile '%STOCKFISH_ZIP%'"

REM -------------------------------
REM VALIDAR DESCARGA
REM -------------------------------
if not exist %STOCKFISH_ZIP% (
    echo ERROR: No se descargo Stockfish.
    pause
    exit /b 1
)

for %%A in (%STOCKFISH_ZIP%) do (
    if %%~zA LSS 100000 (
        echo ERROR: ZIP corrupto o incompleto.
        del /q %STOCKFISH_ZIP%
        pause
        exit /b 1
    )
)

echo [3/5] Extrayendo Stockfish...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
"Expand-Archive -Force '%STOCKFISH_ZIP%' '%STOCKFISH_DIR%'"

REM -------------------------------
REM BUSCAR EXE
REM -------------------------------
echo [4/5] Buscando ejecutable...

set FOUND=0

for /r %STOCKFISH_DIR% %%i in (*.exe) do (
    echo Copiando %%i a raiz...
    copy /Y "%%i" "%STOCKFISH_EXE%" >nul
    set FOUND=1
    goto STOCKFISH_DONE
)

if %FOUND%==0 (
    echo ERROR: No se encontro stockfish.exe dentro del zip.
    pause
    exit /b 1
)

:STOCKFISH_DONE
echo OK: Stockfish listo.

REM ===============================
REM 4. INICIAR SERVIDOR
REM ===============================

echo.
echo ====================================
echo Iniciando servidor...
echo Abre http://localhost:8000
echo ====================================
echo.

python main.py

pause