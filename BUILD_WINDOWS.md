# Chess Trainer - Build Windows Installer

## Arquitectura recomendada

- `launcher.py`: aplicación nativa ligera con Tkinter.
- `main.py`: FastAPI backend que sirve la UI estática.
- `core/stockfish_service.py`: gestor de Stockfish con descarga automática.
- `static/`: assets del frontend.
- `modes/` y `core/`: lógica del juego y análisis.

## Estructura recomendada de carpetas

chesstrainer/
├── launcher.py
├── main.py
├── requirements.txt
├── build_installer.ps1
├── BUILD_WINDOWS.md
├── core/
│   ├── stockfish_service.py
│   └── ...
├── modes/
│   └── ...
└── static/
    ├── index.html
    ├── app.js
    └── style.css

## Qué hace cada componente

- `launcher.py`: inicia el backend de FastAPI en segundo plano, muestra un pequeño estado en pantalla y abre el navegador.
- `main.py`: carga las rutas de la app y resuelve recursos estáticos dentro del ejecutable.
- `core/stockfish_service.py`: detecta, descarga y valida Stockfish para Windows.

## Generar el ejecutable `.exe`

1. Abre PowerShell en `chesstrainer/`.
2. Para una construcción sencilla y versionada, usa el helper:
    ```powershell
    .\make_exe.ps1 -Version 0.1.0
    ```
    Esto instalará dependencias en `venv`, ejecutará `PyInstaller` y dejará el `.exe` en `build\ChessTrainer-v0.1.0.exe`.
3. Alternativa: `build_installer.ps1` también soporta un parámetro `-Version` y dejará el archivo versionado en `build/`.

Nota: la carpeta `build/` contiene los artefactos listos para subir a GitHub Releases.

## Crear instalador Windows (opcional)

1. Instala Inno Setup.
2. Crea un script `.iss` simple que copie `dist\ChessTrainer.exe` a `{app}`.
3. Genera el instalador.

## Recomendaciones para GitHub Releases

- Publica el `.exe` junto con el `installer.exe` generado.
- Incluye `BUILD_WINDOWS.md` como guía de construcción.
- Añade un changelog breve y un `RELEASE_NOTES.md` en el repositorio.
- Si usas GitHub Actions, añade un workflow con `windows-latest` y `pyinstaller`.
