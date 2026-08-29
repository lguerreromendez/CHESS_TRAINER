import logging
import multiprocessing
import sys
import traceback
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI, WebSocket
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from modes.local_mode_handler import handle_local_mode

# =====================================================
# PATH BASE (DEV + PYINSTALLER)
# =====================================================
if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys.executable).parent
    RESOURCE_BASE = Path(sys._MEIPASS)
else:
    BASE_DIR = Path(__file__).resolve().parent
    RESOURCE_BASE = BASE_DIR


LOG_FILE = BASE_DIR / "logs" / "chesstrainer.log"


# =====================================================
# LOGGING (RotatingFileHandler)
# =====================================================
def _setup_logging():
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("chesstrainer")
    if not logger.handlers:
        logger.setLevel(logging.INFO)
        fh = RotatingFileHandler(
            str(LOG_FILE), maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
        )
        fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
        fh.setFormatter(fmt)
        logger.addHandler(fh)
        # also log to console
        ch = logging.StreamHandler()
        ch.setFormatter(fmt)
        logger.addHandler(ch)
    return logger


logger = _setup_logging()


def log_error(title, e):
    try:
        logger.exception(f"{title}: {e}")
    except Exception:
        pass


# =====================================================
# FASTAPI APP
# =====================================================
app = FastAPI(title="Chess Trainer Local")


# =====================================================
# STATIC (PYINSTALLER SAFE)
# =====================================================
try:
    static_dir = RESOURCE_BASE / "static"

    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

except Exception as e:
    log_error("STATIC ERROR", e)


# =====================================================
# STARTUP / SHUTDOWN
# =====================================================
@app.on_event("startup")
async def startup_event():
    print("[STARTUP] Chess Trainer listo")


@app.on_event("shutdown")
async def shutdown_event():
    print("[SHUTDOWN] Chess Trainer cerrando")


# =====================================================
# FRONTEND
# =====================================================
@app.get("/", response_class=HTMLResponse)
async def index():
    try:
        file_path = RESOURCE_BASE / "static" / "index.html"
        return HTMLResponse(file_path.read_text(encoding="utf-8"))
    except Exception as e:
        log_error("INDEX ERROR", e)
        return HTMLResponse(f"<h1>Error cargando frontend</h1><pre>{e}</pre>")


# =====================================================
# WEBSOCKET
# =====================================================
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    try:
        await ws.accept()
        await handle_local_mode(ws, None)
    except Exception as e:
        log_error("WEBSOCKET ERROR", e)


# =====================================================
# RUN SERVER (LAZY IMPORT = MÁS ESTABLE EN EXE)
# =====================================================
def run_server():
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")


# =====================================================
# MAIN ENTRY (CRÍTICO PARA PYINSTALLER)
# =====================================================
if __name__ == "__main__":
    try:
        multiprocessing.freeze_support()
        print("[BOOT] Iniciando Chess Trainer...")

        run_server()

    except Exception as e:
        log_error("FATAL ERROR", e)
        raise
