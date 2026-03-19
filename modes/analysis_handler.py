# modes/analysis_handler.py
"""
WebSocket handler para el modo análisis en tiempo real.
Cada mensaje recibido es un JSON con la posición a analizar:
  { "fen": "...", "depth": 20, "lines": 3 }
El servidor responde con líneas de análisis de Stockfish:
  { "lines": [ { "score": "+0.35", "moves": "e2e4 e7e5 g1f3" }, ... ], "depth": 20 }
"""

import asyncio
import json
import chess
import chess.engine
from concurrent.futures import ThreadPoolExecutor
from fastapi import WebSocket, WebSocketDisconnect
from core.stockfish_service import StockfishService

# Executor dedicado al análisis en tiempo real (1 hilo — Stockfish no es thread-safe)
_analysis_executor = ThreadPoolExecutor(max_workers=1)

# Instancia compartida de Stockfish para análisis
_stockfish = StockfishService()


def _run_analysis(fen: str, depth: int, lines: int) -> list[dict]:
    """Corre síncronamente en el executor. Analiza la posición y devuelve las líneas."""
    try:
        board = chess.Board(fen)
    except Exception:
        return []

    if not _stockfish.engine:
        return []

    depth  = max(1,  min(depth, 30))   # límites seguros
    lines  = max(1,  min(lines, 5))

    try:
        infos = _stockfish.engine.analyse(
            board,
            chess.engine.Limit(depth=depth),
            multipv=lines
        )
    except Exception as e:
        print(f"[ANALYSIS ERROR] {e}")
        return []

    result = []
    for info in infos:
        pv = info.get("pv", [])
        if not pv:
            continue

        # Score desde el punto de vista de quien mueve
        score_obj = info.get("score")
        if score_obj:
            sc = score_obj.relative
            if sc.is_mate():
                score_str = f"M{sc.mate()}" if sc.mate() > 0 else f"-M{abs(sc.mate())}"
            else:
                cp = sc.score(mate_score=10000)
                score_str = f"{cp/100:+.2f}"
        else:
            score_str = "?"

        # Convertir movimientos a SAN para que sean legibles
        san_moves = []
        temp_board = board.copy()
        for move in pv[:8]:          # máximo 8 jugadas por línea
            try:
                san_moves.append(temp_board.san(move))
                temp_board.push(move)
            except Exception:
                break

        result.append({
            "score": score_str,
            "moves": " ".join(san_moves),
            "depth": info.get("depth", depth),
        })

    return result


async def handle_analysis_ws(ws: WebSocket):
    """Handler principal del WebSocket de análisis.
    No requiere autenticación — la ventana se abre desde la app ya autenticada.
    """
    await ws.accept()
    print("[ANALYSIS] Cliente conectado")

    loop = asyncio.get_event_loop()

    # Tarea de análisis en curso (se cancela si llega una nueva petición)
    current_task: asyncio.Task | None = None

    try:
        while True:
            raw = await ws.receive_text()

            try:
                data  = json.loads(raw)
                fen   = data.get("fen",   chess.STARTING_FEN)
                depth = int(data.get("depth", 18))
                lines = int(data.get("lines", 3))
            except Exception:
                await ws.send_text(json.dumps({"error": "Mensaje inválido"}))
                continue

            # Cancelar análisis anterior si todavía está corriendo
            if current_task and not current_task.done():
                current_task.cancel()

            # Aviso inmediato al cliente de que está analizando
            await ws.send_text(json.dumps({"analyzing": True, "fen": fen}))

            async def analyze_and_send(fen=fen, depth=depth, lines=lines):
                try:
                    result = await loop.run_in_executor(
                        _analysis_executor,
                        _run_analysis, fen, depth, lines
                    )
                    await ws.send_text(json.dumps({
                        "analyzing": False,
                        "fen":       fen,
                        "depth":     depth,
                        "lines":     result,
                    }))
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    print(f"[ANALYSIS SEND ERROR] {e}")

            current_task = asyncio.create_task(analyze_and_send())

    except WebSocketDisconnect:
        print("[ANALYSIS] Cliente desconectado")
    except Exception as e:
        print(f"[ANALYSIS WS ERROR] {e}")
    finally:
        if current_task and not current_task.done():
            current_task.cancel()