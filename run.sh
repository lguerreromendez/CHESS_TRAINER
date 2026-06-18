#!/bin/bash
# Chess Trainer · Modo Local - Linux/macOS Launcher
# Este script instala dependencias y ejecuta el servidor localmente

echo ""
echo "===================================="
echo "Chess Trainer - Modo Local (Linux/macOS)"
echo "===================================="
echo ""

# Crear entorno virtual si no existe
if [ ! -d "venv" ]; then
    echo "Creando entorno virtual..."
    python3 -m venv venv
    if [ $? -ne 0 ]; then
        echo "ERROR: No se pudo crear el entorno virtual"
        echo "Asegurate de tener Python 3.8+ instalado"
        exit 1
    fi
fi

# Activar entorno virtual
echo "Activando entorno virtual..."
source venv/bin/activate

# Instalar/actualizar dependencias
echo "Instalando dependencias..."
pip install -r requirements.txt --upgrade
if [ $? -ne 0 ]; then
    echo "ERROR: No se pudieron instalar las dependencias"
    exit 1
fi

# Verificar que Stockfish está instalado
echo "Verificando Stockfish..."
if ! command -v stockfish &> /dev/null; then
    echo ""
    echo "⚠️  ADVERTENCIA: Stockfish no encontrado"
    echo ""
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "Instálalo con:"
        echo "  Ubuntu/Debian: sudo apt-get install stockfish"
        echo "  Fedora: sudo dnf install stockfish"
        echo "  Arch: sudo pacman -S stockfish"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "Instálalo con:"
        echo "  brew install stockfish"
    fi
    echo ""
fi

# Ejecutar servidor
echo ""
echo "===================================="
echo "Iniciando servidor..."
echo "Abre http://localhost:8000 en tu navegador"
echo "===================================="
echo ""

python main.py
