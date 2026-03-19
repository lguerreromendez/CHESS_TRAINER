# modes/multiplayer_mode.py
import asyncio
import chess
import time
import random
import json
from concurrent.futures import ThreadPoolExecutor
from firebase_admin import firestore
from modes.local_mode import LocalMode
from core.lobby import Lobby

_analysis_executor = ThreadPoolExecutor(max_workers=1)


class MultiplayerGame:
    pgn_list     = []
    pgn_meta     = []
    last_refresh = 0

    @classmethod
    async def refresh_pgn_list(cls, force=False):
        now = time.time()
        if not force and now - cls.last_refresh < 300:
            return
        try:
            db   = firestore.client()
            docs = db.collection('pgn_files').get()
            pgns, meta = [], []
            for doc in docs:
                data = doc.to_dict()
                pgn  = (data.get('pgn') or data.get('PGN')
                        or data.get('pgn_text') or data.get('PGN_text'))
                if pgn:
                    pgns.append(pgn)
                    meta.append({'id': doc.id,
                                 'White': data.get('White', '?'),
                                 'Black': data.get('Black', '?'),
                                 'Opening': data.get('Opening', ''),
                                 'ECO': data.get('ECO', '')})
            if pgns:
                cls.pgn_list = pgns
                cls.pgn_meta = meta
            else:
                try:
                    cls.pgn_list = [open("partida.pgn").read()]
                    cls.pgn_meta = [{}]
                except Exception:
                    pass
            cls.last_refresh = now
            print(f"[PGN REFRESH] {len(cls.pgn_list)} PGNs")
        except Exception as e:
            print(f"[PGN REFRESH ERROR] {e}")

    # ── Init ──────────────────────────────────────────────────────

    def __init__(self, lobby: Lobby, starting_mode: int | None = None,
                 turn_seconds: int = 10):
        self.lobby               = lobby
        self.submitted_this_turn = set()
        self.advance_handle      = None
        self.current_pgn_index   = 0
        self.next_advance_ts     = 0
        self.paused              = False
        self.started             = False
        self.turn_seconds        = max(5, min(turn_seconds, 120))
        # Estadísticas por jugador: {player_id: {gm, engine, miss, score}}
        self.player_stats: dict  = {}
        self.global_scores: dict = {}  # acumulado entre partidas

        if starting_mode is not None and isinstance(starting_mode, int):
            self.current_pgn_index = max(0, min(starting_mode - 1,
                                                len(self.pgn_list) - 1))
        elif self.pgn_list:
            self.current_pgn_index = random.randint(0, len(self.pgn_list) - 1)

        self.game = LocalMode(auto_load=False)
        if self.pgn_list:
            pgn_text = self.pgn_list[self.current_pgn_index]
            self.current_pgn_text = pgn_text
            self.game.load_pgn_and_analyze(pgn_text)
        else:
            self.current_pgn_text = ""

    def _ensure_stats(self, player_id: str):
        if player_id not in self.player_stats:
            self.player_stats[player_id] = {
                'gm': 0, 'engine': 0, 'miss': 0, 'score': 0}

    # ── Timer ─────────────────────────────────────────────────────

    async def start_timer(self):
        self.started = True
        await self.schedule_advance()

    async def schedule_advance(self):
        if self.advance_handle:
            self.advance_handle.cancel()
        if self.paused or not self.started:
            return

        delay = self.turn_seconds if self.lobby.players else max(self.turn_seconds, 20)
        loop  = asyncio.get_event_loop()

        def safe_advance():
            try:
                asyncio.create_task(self.advance_turn())
            except RuntimeError as e:
                print(f"[SCHEDULE ERROR] {e}")

        self.advance_handle  = loop.call_later(delay, safe_advance)
        self.next_advance_ts = int(time.time()) + delay
        await self.lobby.broadcast(f"next_advance:{self.next_advance_ts}")

    async def pause(self):
        self.paused = True
        if self.advance_handle:
            self.advance_handle.cancel()
            self.advance_handle = None
        # Enviar ts=0 para detener el countdown en todos los clientes
        await self.lobby.broadcast("next_advance:0")
        await self.lobby.broadcast("owner_paused:1")
        await self.lobby.broadcast("status:⏸ Partida pausada por el admin")

    async def resume(self):
        self.paused = False
        await self.lobby.broadcast("owner_paused:0")
        await self.lobby.broadcast("status:▶ Partida reanudada")
        await self.schedule_advance()

    # ── Avance de turno ───────────────────────────────────────────

    async def advance_turn(self):
        # Si está pausado no avanzar aunque la tarea ya estuviera en vuelo
        if self.paused:
            return
        try:
            await self.refresh_pgn_list()

            total = len(self.game.pgn_moves)
            if self.game.current_turn >= total:
                await self._finish_game()
                return

            correct = self.game.pgn_moves[self.game.current_turn]
            self.game.board.push(correct)
            self.game.current_turn += 1

            fen           = self.game.board.fen()
            next_move_num = self.game.current_turn + 1

            await self.lobby.broadcast(f"fen:{fen}")
            await self.lobby.broadcast(
                f"turno:Adivina jugada {next_move_num} de {total}")
            await self.lobby.broadcast(
                f"game_progress:{self.game.current_turn}|{total}")
            self.submitted_this_turn = set()
            # Solo reprogramar si no está pausado
            if not self.paused:
                await self.schedule_advance()

        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[ADVANCE ERROR] {type(e).__name__}: {e}")

    async def _finish_game(self):
        """Partida terminada — enviar resumen a cada jugador y señal al lobby."""
        await self.lobby.broadcast("status:🏁 ¡Partida terminada!")

        # Enviar resumen personalizado a cada jugador
        for pid, p in list(self.lobby.players.items()):
            stats = self.player_stats.get(pid, {})
            total_m = stats.get('gm', 0) + stats.get('engine', 0) + stats.get('miss', 0)
            pct   = round((stats.get('gm', 0) + stats.get('engine', 0)) / total_m * 100) if total_m else 0
            score = self.lobby.scores.get(pid, 0)
            if pct >= 90:   grade = "S"
            elif pct >= 75: grade = "A"
            elif pct >= 55: grade = "B"
            elif pct >= 35: grade = "C"
            else:           grade = "D"

            summary = {
                "score":       score,
                "gm_hits":     stats.get('gm', 0),
                "engine_hits": stats.get('engine', 0),
                "misses":      stats.get('miss', 0),
                "total_moves": total_m,
                "pct":         pct,
                "grade":       grade,
                "best_move":   None,
            }
            try:
                await p.ws.send_text(f"gameover:{json.dumps(summary)}")
            except Exception:
                pass

        # Acumular scores globales antes del reset
        for pid in list(self.lobby.players.keys()):
            ps = self.lobby.scores.get(pid, 0)
            self.global_scores[pid] = self.global_scores.get(pid, 0) + ps

        # Resumen grupal para lobby privado
        is_private = getattr(self.lobby, 'is_private', False)
        if is_private:
            group = []
            for pid, p in list(self.lobby.players.items()):
                stats = self.player_stats.get(pid, {})
                group.append({
                    "name":          p.display_name,
                    "score":         self.lobby.scores.get(pid, 0),
                    "score_global":  self.global_scores.get(pid, 0) + self.lobby.scores.get(pid, 0),
                    "gm":            stats.get('gm', 0),
                    "engine":        stats.get('engine', 0),
                    "misses":        stats.get('miss', 0),
                })
            group.sort(key=lambda x: x["score"], reverse=True)
            await self.lobby.broadcast(f"gameover_group:{json.dumps(group)}")
            await self.lobby.broadcast("lobby_game_ended:1")
        else:
            # Lobby general: cargar siguiente PGN automáticamente
            await asyncio.sleep(3)
            await self._load_next_pgn_async()

    # ── Carga asíncrona ───────────────────────────────────────────

    async def _load_next_pgn_async(self):
        try:
            if not self.pgn_list:
                await self.lobby.broadcast("feedback:fail|No hay partidas||0")
                return

            self.current_pgn_index = (self.current_pgn_index + 1) % len(self.pgn_list)
            pgn_text = self.pgn_list[self.current_pgn_index]
            self.current_pgn_text = pgn_text

            await self.lobby.broadcast("game_transition:start")
            await self.lobby.broadcast("status:Cargando siguiente partida…")

            try:
                import io as _io
                import chess.pgn as _pgn
                g = _pgn.read_game(_io.StringIO(pgn_text))
                if g:
                    await self.lobby.broadcast(
                        f"pgn_info:{json.dumps(dict(g.headers))}")
            except Exception:
                pass

            loop = asyncio.get_event_loop()
            progress_queue: asyncio.Queue = asyncio.Queue()

            def progress_cb(current, total):
                loop.call_soon_threadsafe(
                    progress_queue.put_nowait, (current, total))

            future = loop.run_in_executor(
                _analysis_executor,
                lambda: self.game.load_pgn_and_analyze(
                    pgn_text, progress_cb=progress_cb))

            while not future.done():
                try:
                    c, t = await asyncio.wait_for(
                        progress_queue.get(), timeout=0.2)
                    await self.lobby.broadcast(f"analysis_progress:{c}|{t}")
                except asyncio.TimeoutError:
                    pass

            await future

            # Reset stats para nueva partida
            self.player_stats = {}
            self.started = False

            await self.lobby.broadcast("analysis:complete")
            await self.lobby.broadcast(f"pgn:{pgn_text}")
            await asyncio.sleep(1)
            await self.start_timer()
            await self.advance_turn()

        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[LOAD_NEXT_PGN ERROR] {type(e).__name__}: {e}")

    # ── Registro de movimiento ────────────────────────────────────

    async def register_move(self, player_ws, player_id: str, uci: str):
        if self.game.current_turn >= len(self.game.pgn_moves):
            await player_ws.send_text("feedback:info|Partida terminada||0|—")
            return 0, "Partida ya terminada"

        if self.paused:
            await player_ws.send_text(
                "feedback:info|El admin ha pausado la partida||0|—")
            return 0, "Partida pausada"

        try:
            move = chess.Move.from_uci(uci)
        except Exception:
            return 0, "Movimiento inválido"

        # Bloquear si el jugador ya envió jugada este turno
        if player_id in self.submitted_this_turn:
            await player_ws.send_text(
                "feedback:info|Ya has jugado este turno — espera al siguiente||0|—")
            return 0, "Ya jugaste este turno"

        self._ensure_stats(player_id)
        points, feedback, top3_san, top3_scores, _ = self.game.calculate_points(
            move, self.game.current_turn)

        # Actualizar stats del jugador
        is_gm   = (move == self.game.pgn_moves[self.game.current_turn])
        top3uci = [i[0] for i in self.game.stockfish_best[self.game.current_turn]]
        is_eng1 = bool(top3uci) and move.uci() == top3uci[0]
        if is_gm:
            self.player_stats[player_id]['gm'] += 1
        elif is_eng1 or points > 0:
            self.player_stats[player_id]['engine'] += 1
        else:
            self.player_stats[player_id]['miss'] += 1
        self.player_stats[player_id]['score'] += points

        correct_move = self.game.pgn_moves[self.game.current_turn].uci()
        self.submitted_this_turn.add(player_id)

        top3_str = "|".join(
            f"{s} ({sc/100:+.2f})" for s, sc in zip(top3_san, top3_scores)
        ) if top3_san else ""

        await player_ws.send_text(
            f"feedback:{'success' if points > 0 else 'fail'}"
            f"|{feedback}|{top3_str}|{points}|{correct_move}")

        try:
            gm_san = self.game.board.san(
                self.game.pgn_moves[self.game.current_turn])
        except Exception:
            gm_san = correct_move
        await self.lobby.broadcast(f"gm_move:{gm_san}")

        if (len(self.submitted_this_turn) >= len(self.lobby.players)
                and len(self.lobby.players) > 0):
            await self.advance_turn()

        return points, feedback

    async def cleanup(self):
        if self.advance_handle:
            self.advance_handle.cancel()