import asyncio
from fastapi import FastAPI, WebSocket, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from modes.local_mode_handler import handle_local_mode

app = FastAPI(title="Chess Trainer Local")
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.on_event("startup")
async def startup_event():
    print("[STARTUP] Chess Trainer Local - Listo")


@app.on_event("shutdown")
async def shutdown_event():
    print("[SHUTDOWN] Chess Trainer Local cerrando")


@app.get("/", response_class=HTMLResponse)
async def index():
    with open("static/index.html", encoding="utf-8") as f:
        return HTMLResponse(f.read())


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    # Modo local único - sin autenticación
    await ws.accept()
    await handle_local_mode(ws, None)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)