# Chess Trainer · Modo Local

Versión local completamente autónoma sin servidores. **Descárgalo y juega sin conexión a internet.**

# FORMA SENCILLA INSTALACION:
DESCARGA ZIP, descomprime y ejecuta run.bat

## Requisitos

- **Python 3.8+** (recomendado 3.10+)
- **Stockfish**  https://stockfishchess.org/download/     poner en la carpeta principal con nombre stockfish.exe

## Instalación rápida

### En Windows

1. **Descargar el proyecto**
   ```
   git clone [tu-repo]
   cd chesstrainer
   ```

2. **Crear entorno virtual**
   ```
   python -m venv venv
   venv\Scripts\activate
   ```

3. **Instalar dependencias**
   ```
   pip install -r requirements.txt
   ```

4. **Ejecutar**
   ```
   run.bat
   ```

   > Si `stockfish.exe` no existe, `run.bat` hará lo siguiente:
   > - buscará `stockfish.exe` en el proyecto
   > - si encuentra `stockfish-windows-x86-64-avx2.exe`, lo copiará a `stockfish.exe`
   > - si encuentra `stockfish.zip`, lo descomprimirá y extraerá el ejecutable
   > - si no encuentra nada, intentará descargar Stockfish automáticamente

5. **Abrir en navegador**
   - Ve a `http://localhost:8000` en tu navegador

### En macOS / Linux

1. **Descargar el proyecto**
   ```
   git clone [tu-repo]
   cd chesstrainer
   ```

2. **Crear entorno virtual**
   ```
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **Instalar Stockfish** (si no lo tienes)
   ```
   # macOS
   brew install stockfish
   
   # Ubuntu/Debian
   sudo apt-get install stockfish
   
   # Fedora
   sudo dnf install stockfish
   ```

4. **Instalar dependencias Python**
   ```
   pip install -r requirements.txt
   ```

5. **Ejecutar**
   ```
   python main.py
   ```

6. **Abrir en navegador**
   - Ve a `http://localhost:8000` en tu navegador

## Cómo usar

### Comenzar
1. Abre `http://localhost:8000`
2. Verás la interfaz del tablero de ajedrez
3. Haz clic en **"📋 Pegar PGN"**

### Cargar una partida
1. Copia el PGN de una partida desde:
   - Chess.com
   - Lichess.org
   - Cualquier otra fuente de PGN
2. Pégalo en el panel que aparece
3. Selecciona la profundidad de análisis (8-28, más alto = más preciso pero más lento)
4. Haz clic en **"⚙ Analizar con Stockfish"**
5. ¡A jugar! Adivina las jugadas del gran maestro

### Controles
- **Arrastra piezas** para jugar movimientos
- **↺ Reiniciar** - Nueva partida
- **💡 Pista** - Ver sugerencias de Stockfish
- **📋 Pegar PGN** - Cargar una nueva partida
- **Flechas ← →** - Navegar por el historial
- **Inicio/Fin** - Primera/última jugada

## Estructura de archivos

```
chesstrainer/
├── main.py                 # Servidor FastAPI local
├── requirements.txt        # Dependencias Python
├── stockfish.exe          # Motor Stockfish (Windows)
├── stockfish              # Motor Stockfish (Linux)
├── core/
│   ├── stockfish_service.py    # Interfaz con Stockfish
│   └── player.py              # Clase jugador
├── modes/
│   ├── local_mode.py           # Lógica del juego local
│   └── local_mode_handler.py   # Handler WebSocket
└── static/
    ├── index.html             # Interfaz web
    ├── app.js                 # Lógica del cliente
    └── style.css              # Estilos
```

## Solución de problemas

### "Stockfish no encontrado"
- **Windows:** Asegúrate de que `stockfish.exe` esté en la raíz del proyecto
- **Linux/macOS:** Instala Stockfish con tu gestor de paquetes (ver arriba)

### "Puerto 8000 ya en uso"
Cambia el puerto en `main.py`:
```python
if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001)  # Cambiar a 8001
```

### "No puedo conectarme"
- Asegúrate de que el servidor está corriendo (`python main.py`)
- Abre `http://localhost:8000` (no `127.0.0.1:8000`)
- Revisa que no hay firewalls bloqueando el puerto 8000

## Compartir con amigos

Para enviar a un amigo:
1. Comprime la carpeta `chesstrainer/` entera
2. Tu amigo la descomprime
3. Sigue los pasos de instalación arriba
4. ¡Listo! No necesita ninguna cuenta ni servidor en internet

## Características

✅ Totalmente local - sin internet requerida
✅ Modo local con análisis de Stockfish
✅ Carga PGN desde cualquier fuente
✅ Navegación de partidas
✅ Interfaz limpia y responsiva
✅ Sin autenticación, sin servidores, sin cuentas

## Requisitos de sistema

- **RAM mínima:** 500 MB
- **Espacio en disco:** ~200 MB
- **CPU:** Cualquiera (más rápida = análisis más profundo)

## Licencia

Código bajo licencia de usuario.
Stockfish es software libre bajo licencia GPL.

---

¿Dudas? Abre un issue o contacta al desarrollador.
