import logging
import multiprocessing
import sys
import traceback
from logging.handlers import RotatingFileHandler
from pathlib import Path
from types import SimpleNamespace

from fastapi import Body, FastAPI, WebSocket
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from core.lobby_manager import LobbyManager
from modes.local_mode_handler import handle_local_mode
from modes.multiplayer_mode_handler import handle_multiplayer_mode
from modes.teacher_mode_handler import handle_teacher_mode

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
lobby_manager = LobbyManager()


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
    lobby_manager.create_default_lobby()
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
        mode = (ws.query_params.get("mode") or "local").lower()
        uid = ws.query_params.get("uid") or ws.query_params.get("user_id") or "anon"
        display_name = (
            ws.query_params.get("display_name") or ws.query_params.get("name") or uid
        )
        email = ws.query_params.get("email") or f"{display_name}@local"
        firebase_user = SimpleNamespace(uid=uid, email=email)

        if mode == "multiplayer":
            lobby_id = ws.query_params.get("lobby_id")
            await handle_multiplayer_mode(ws, firebase_user, lobby_id, lobby_manager)
        elif mode == "teacher":
            lobby_id = ws.query_params.get("lobby_id")
            await handle_teacher_mode(ws, firebase_user, lobby_id, lobby_manager)
        else:
            await handle_local_mode(ws, None)
    except Exception as e:
        log_error("WEBSOCKET ERROR", e)


@app.post("/create_lobby")
async def create_lobby(payload: dict = Body(...)):
    owner_uid = payload.get("uid")
    turn_seconds = int(payload.get("turn_seconds", 10))
    if not owner_uid:
        return {"error": "uid requerido"}

    lobby = lobby_manager.create_private_lobby(owner_uid, turn_seconds=turn_seconds)
    return {"lobby_id": lobby.id, "turn_seconds": lobby.turn_seconds}


@app.get("/lobby/{lobby_id}/exists")
async def lobby_exists(lobby_id: str):
    lobby = lobby_manager.get_lobby(lobby_id)
    return {"exists": bool(lobby)}


@app.delete("/lobby/{lobby_id}")
async def delete_lobby(lobby_id: str, payload: dict = Body(...)):
    owner_uid = payload.get("uid")
    if not owner_uid:
        return {"error": "uid requerido"}

    deleted = await lobby_manager.delete_lobby(lobby_id, owner_uid)
    return {"deleted": deleted}


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
