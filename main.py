import asyncio
import os
import json
from fastapi import FastAPI, WebSocket, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import firebase_admin
from firebase_admin import credentials, auth

from core.lobby_manager import LobbyManager
from modes.local_mode_handler import handle_local_mode
from modes.multiplayer_mode_handler import handle_multiplayer_mode
from modes.teacher_mode_handler import handle_teacher_mode
from modes.multiplayer_mode import MultiplayerGame
from modes.analysis_handler import handle_analysis_ws

app = FastAPI(title="Chess Trainer")
app.mount("/static", StaticFiles(directory="static"), name="static")

# Firebase: en Railway usa variable de entorno, en local usa el archivo JSON
_cred_json = os.getenv("GOOGLE_APPLICATION_CREDENTIALS_JSON")
if _cred_json:
    cred = credentials.Certificate(json.loads(_cred_json))
else:
    cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred)

lobby_manager = LobbyManager()
lobby_manager.create_default_lobby()


@app.on_event("startup")
async def startup_event():
    lobby_manager.create_default_lobby()
    try:
        await MultiplayerGame.refresh_pgn_list(force=True)
    except Exception as e:
        print(f"[STARTUP WARNING] {e}")
    print("[STARTUP] Listo")


@app.on_event("shutdown")
async def shutdown_event():
    for lobby in lobby_manager.lobbies.values():
        if hasattr(lobby, 'multi_game') and lobby.multi_game:
            await lobby.multi_game.cleanup()


@app.get("/", response_class=HTMLResponse)
async def index():
    with open("static/index.html", encoding="utf-8") as f:
        return HTMLResponse(f.read())


@app.get("/analysis", response_class=HTMLResponse)
async def analysis_page():
    with open("static/analysis.html", encoding="utf-8") as f:
        return HTMLResponse(f.read())


@app.post("/create_lobby")
async def create_private_lobby(request: Request):
    try:
        data         = await request.json()
        uid          = data.get("uid", "unknown")
        turn_seconds = int(data.get("turn_seconds", 10))
        lobby        = lobby_manager.create_private_lobby(
            owner_uid=uid, turn_seconds=turn_seconds)
        return JSONResponse({
            "lobby_id":     lobby.id,
            "is_private":   True,
            "turn_seconds": turn_seconds,
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.delete("/lobby/{lobby_id}")
async def delete_lobby(lobby_id: str, request: Request):
    try:
        data    = await request.json()
        uid     = data.get("uid", "")
        deleted = await lobby_manager.delete_lobby(lobby_id, uid)
        if deleted:
            return JSONResponse({"deleted": True})
        return JSONResponse({"error": "No autorizado o lobby no encontrado"},
                            status_code=403)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/lobby/{lobby_id}/exists")
async def lobby_exists(lobby_id: str):
    """Comprueba si un lobby existe antes de conectar el WebSocket."""
    lobby = lobby_manager.get_lobby(lobby_id)
    if not lobby:
        return JSONResponse({"exists": False, "reason": "Lobby no encontrado"})
    is_private = getattr(lobby, 'is_private', False)
    return JSONResponse({
        "exists":       True,
        "is_private":   is_private,
        "player_count": len(lobby.players),
    })


@app.websocket("/ws")
async def websocket_endpoint(
    ws: WebSocket,
    mode: str     = Query("local"),
    uid: str      = Query(None),
    lobby_id: str = Query(None)
):
    if not uid:
        await ws.close(code=1008, reason="UID requerido")
        return
    try:
        user = auth.get_user(uid)
    except Exception:
        await ws.close(code=1008, reason="Auth inválida")
        return

    await ws.accept()

    if mode == "local":
        await handle_local_mode(ws, user)
    elif mode == "multiplayer":
        await handle_multiplayer_mode(ws, user, lobby_id, lobby_manager)
    elif mode == "teacher":
        await handle_teacher_mode(ws, user, lobby_id, lobby_manager)
    else:
        await ws.send_text("error:Modo no soportado")
        await ws.close()


@app.websocket("/ws/analysis")
async def analysis_ws(ws: WebSocket):
    await handle_analysis_ws(ws)