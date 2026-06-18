@echo off
REM Chess Trainer · Modo Local - Windows Launcher
REM Este script instala dependencias y ejecuta el servidor localmente

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
        echo Asegurate de tener Python 3.8+ instalado
        pause
        exit /b 1
    )
)

REM Activar entorno virtual
echo Activando entorno virtual...
call venv\Scripts\activate.bat

REM Instalar/actualizar dependencias
echo Instalando dependencias...
pip install -r requirements.txt --upgrade
if errorlevel 1 (
    echo ERROR: No se pudieron instalar las dependencias
    pause
    exit /b 1
)

REM Ejecutar servidor
echo.
echo ====================================
echo Iniciando servidor...
echo Abre http://localhost:8000 en tu navegador
echo ====================================
echo.

python main.py

pause
