# modes/local_mode_handler.py

import io
import json
import asyncio
import chess.pgn
from fastapi import WebSocketDisconnect
from modes.local_mode import LocalMode
from core.player import Player
from concurrent.futures import ThreadPoolExecutor

_analysis_executor = ThreadPoolExecutor(max_workers=1)


async def handle_local_mode(ws, firebase_user):
    game = LocalMode(auto_load=False)   # sin cargar partida por defecto
    player = Player(ws, name="Jugador Local")
    player.uid = "local"

    await _send_empty_state(ws)

    try:
        while True:
            data = await ws.receive_text()

            if data.startswith("move:"):
                uci = data[5:].strip()
                await game.handle_move(player, uci, None)

            elif data == "reset":
                game = LocalMode(auto_load=False)
                player.score = 0
                await _send_empty_state(ws)

            elif data == "suggest":
                top3_str = game.get_top3_str(game.current_turn)
                if top3_str:
                    await ws.send_text(
                        f"feedback:info|💡 Sugerencias Stockfish|{top3_str}|0")
                else:
                    await ws.send_text(
                        "feedback:info|No hay sugerencias disponibles||0")

            elif data.startswith("load_pgn:"):
                # Formato: "load_pgn:depth=20|[texto pgn]"
                # o simplemente "load_pgn:[texto pgn]" (depth por defecto)
                payload  = data[9:].strip()
                depth    = None
                pgn_text = payload

                if payload.startswith("depth="):
                    sep = payload.index("|")
                    try:
                        depth = int(payload[6:sep])
                    except Exception:
                        depth = None
                    pgn_text = payload[sep + 1:].strip()

                if not pgn_text:
                    await ws.send_text("feedback:fail|PGN vacío o inválido||0")
                    continue

                await _analyze_with_progress(ws, game, pgn_text, depth)
                player.score = 0
                await ws.send_text(
                    f"pgn_info:{_extract_pgn_headers_json(pgn_text)}")
                await _send_initial_state(ws, game)
                await ws.send_text(
                    "feedback:success|¡Partida lista! Adivina las jugadas del GM||0")

            elif data.startswith("{"):
                try:
                    info = json.loads(data)
                    if info.get("type") == "user_info":
                        player.display_name = info.get(
                            "displayName", player.name)
                        player.uid = info.get("uid")
                        print(f"[LOCAL] {player.display_name}")
                except Exception:
                    pass

    except WebSocketDisconnect:
        print(f"[LOCAL] {player.display_name} desconectado")
    except asyncio.CancelledError:
        print(f"[LOCAL CANCELLED] {player.display_name}")
        raise
    except Exception as e:
        print(f"[LOCAL ERROR] {player.display_name}: {e}")


async def _analyze_with_progress(ws, game: LocalMode,
                                 pgn_text: str, depth: int | None):
    """Corre el análisis en el executor y envía mensajes de progreso
    via WebSocket conforme avanza jugada a jugada."""

    loop = asyncio.get_event_loop()
    progress_queue: asyncio.Queue = asyncio.Queue()

    def progress_cb(current: int, total: int):
        """Llamado desde el hilo del executor en cada jugada analizada."""
        loop.call_soon_threadsafe(
            progress_queue.put_nowait, (current, total)
        )

    # Lanzar análisis en background
    future = loop.run_in_executor(
        _analysis_executor,
        _run_analysis,
        game, pgn_text, depth, progress_cb
    )

    # Consumir la cola de progreso mientras el análisis corre
    while not future.done():
        try:
            current, total = await asyncio.wait_for(
                progress_queue.get(), timeout=0.2)
            await ws.send_text(
                f"analysis_progress:{current}|{total}")
        except asyncio.TimeoutError:
            pass
        except Exception:
            break

    # Vaciar cualquier progreso restante
    while not progress_queue.empty():
        try:
            current, total = progress_queue.get_nowait()
            await ws.send_text(f"analysis_progress:{current}|{total}")
        except Exception:
            break

    # Esperar a que termine (propaga excepciones si las hay)
    await future


def _run_analysis(game: LocalMode, pgn_text: str,
                  depth: int | None, progress_cb):
    """Función síncrona que corre en el ThreadPoolExecutor."""
    game.load_pgn_and_analyze(pgn_text, depth=depth,
                               progress_cb=progress_cb)


async def _send_empty_state(ws):
    """Estado inicial vacío — sin partida cargada todavía."""
    await ws.send_text("fen:start")
    await ws.send_text("score:0")
    await ws.send_text("turno:Pega un PGN para empezar")
    await ws.send_text("local_no_pgn:1")


async def _send_initial_state(ws, game: LocalMode):
    """Estado con partida cargada — envía FEN, score y turno."""
    total = len(game.pgn_moves)
    await ws.send_text(f"fen:{game.board.fen()}")
    await ws.send_text("score:0")
    await ws.send_text(
        f"turno:Adivina jugada 1 de {total if total > 0 else '?'}")


def _extract_pgn_headers_json(pgn_text: str) -> str:
    try:
        game = chess.pgn.read_game(io.StringIO(pgn_text))
        if game:
            return json.dumps(dict(game.headers))
    except Exception:
        pass
    return "{}"


def _extract_pgn_headers_json_from_file(pgn_path) -> str:
    try:
        pgn_text = pgn_path.read_text(encoding="utf-8")
        return _extract_pgn_headers_json(pgn_text)
    except Exception:
        return "{}"