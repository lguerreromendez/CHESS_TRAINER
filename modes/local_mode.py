# modes/local_mode.py

import io
import asyncio
import json
import chess
import chess.pgn
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from core.stockfish_service import StockfishService

_bg_executor = ThreadPoolExecutor(max_workers=1)


class LocalMode:
    def __init__(self, pgn_file=None, auto_load: bool = True):
        self.board = chess.Board()
        self.pgn_file = Path(pgn_file) if pgn_file else Path("partida.pgn")
        self.pgn_moves = []
        self.stockfish_best = []   # [(uci, san, score), ...]
        self.current_turn = 0
        self.score_total = 0
        self.depth = 16
        self.stockfish = StockfishService()
        # ── Estadísticas de sesión ──
        self._gm_hits     = 0   # acertó con GM
        self._engine_hits = 0   # acertó con módulo (no GM)
        self._misses      = 0   # falló
        self._best_move   = None  # (san, points) mejor jugada
        if auto_load:
            self.load_pgn_and_analyze(self.pgn_file)

    def reset(self):
        self.load_pgn_and_analyze(self.pgn_file)

    def _reset_stats(self):
        self._gm_hits = 0
        self._engine_hits = 0
        self._misses = 0
        self._best_move = None

    def load_pgn_and_analyze(self, pgn_input, depth: int = None,
                              progress_cb=None):
        if depth is not None:
            self.depth = max(8, min(depth, 30))

        self.board.reset()
        self.pgn_moves = []
        self.stockfish_best = []
        self.current_turn = 0
        self.score_total = 0
        self._reset_stats()

        if isinstance(pgn_input, (str, Path)) and Path(pgn_input).exists():
            pgn_text = Path(pgn_input).read_text(encoding="utf-8")
        elif isinstance(pgn_input, str):
            pgn_text = pgn_input
        else:
            print("PGN inválido:", pgn_input)
            return

        try:
            game = chess.pgn.read_game(io.StringIO(pgn_text))
            if not game:
                return

            total = 0
            node = game
            while node.variations:
                total += 1
                node = node.variation(0)

            temp_board = chess.Board()
            node = game
            current = 0

            while node.variations:
                next_node = node.variation(0)
                move = next_node.move
                self.pgn_moves.append(move)

                info = self.stockfish.analyze(temp_board, depth=self.depth)
                best_info = []
                for pv_info in info[:3]:
                    if pv_info.get("pv"):
                        m   = pv_info["pv"][0]
                        uci = m.uci()
                        try:
                            san = temp_board.san(m)
                        except Exception:
                            san = uci
                        score = pv_info.get("score").relative.score(
                            mate_score=10000) or 0
                        best_info.append((uci, san, score))
                self.stockfish_best.append(best_info)
                temp_board.push(move)
                node = next_node

                current += 1
                if progress_cb:
                    progress_cb(current, total)

            print(f"[PGN] {len(self.pgn_moves)} jugadas (depth={self.depth})")
        except Exception as e:
            print(f"[PGN ERROR] {e}")

    def get_top3_str(self, turn: int) -> str:
        if turn < len(self.stockfish_best) and self.stockfish_best[turn]:
            best = self.stockfish_best[turn]
            return "|".join(
                f"{san} ({score/100:+.2f})" for _, san, score in best)
        return ""

    def get_summary(self, total_score: int) -> dict:
        """Genera el resumen de la partida para enviarlo al cliente."""
        total = self._gm_hits + self._engine_hits + self._misses
        pct   = round((self._gm_hits + self._engine_hits) / total * 100) if total else 0

        if pct >= 90: grade = "S"
        elif pct >= 75: grade = "A"
        elif pct >= 55: grade = "B"
        elif pct >= 35: grade = "C"
        else: grade = "D"

        return {
            "score":        total_score,
            "gm_hits":      self._gm_hits,
            "engine_hits":  self._engine_hits,
            "misses":       self._misses,
            "total_moves":  total,
            "pct":          pct,
            "grade":        grade,
            "best_move":    self._best_move,
        }

    # ── Evaluación en background ──────────────────────────────────

    def _eval_move_sync(self, board_fen: str, player_uci: str) -> float | None:
        try:
            board = chess.Board(board_fen)
            move  = chess.Move.from_uci(player_uci)
            if move not in board.legal_moves:
                return None
            board.push(move)
            info = self.stockfish.engine.analyse(
                board, chess.engine.Limit(depth=14))
            score_obj = info.get("score")
            if score_obj is None:
                return None
            return score_obj.pov(not board.turn).score(mate_score=10000)
        except Exception as e:
            print(f"[BG EVAL ERROR] {e}")
            return None

    async def _send_bg_eval(self, ws, board_fen: str, player_uci: str):
        try:
            b   = chess.Board(board_fen)
            m   = chess.Move.from_uci(player_uci)
            san = b.san(m)
        except Exception:
            san = player_uci
        try:
            await ws.send_text(f"bg_eval:analyzing|{san}")
            loop  = asyncio.get_event_loop()
            score = await loop.run_in_executor(
                _bg_executor, self._eval_move_sync, board_fen, player_uci)
            if score is not None:
                await ws.send_text(f"bg_eval:result|{san}|{score/100:+.2f}")
            else:
                await ws.send_text(f"bg_eval:result|{san}|?")
        except Exception as e:
            print(f"[BG EVAL SEND ERROR] {e}")

    # ── Puntuación ────────────────────────────────────────────────

    def calculate_points(self, move: chess.Move, turn: int):
        if turn >= len(self.pgn_moves):
            return 0, "Partida ya terminada", [], [], False

        correct_move = self.pgn_moves[turn]
        best_info    = self.stockfish_best[turn]

        top3_san    = [i[1] for i in best_info]
        top3_scores = [i[2] for i in best_info]
        top3_uci    = [i[0] for i in best_info]

        gm_uci     = correct_move.uci()
        player_uci = move.uci()
        is_gm      = (move == correct_move)
        is_engine1 = bool(top3_uci) and player_uci == top3_uci[0]

        try:
            gm_san = self.board.san(correct_move)
        except Exception:
            gm_san = gm_uci

        def _record(points, label, top3_san, top3_scores, needs_bg):
            # Actualizar estadísticas de sesión
            if is_gm:
                self._gm_hits += 1
            elif is_engine1 or (not needs_bg and points > 0):
                self._engine_hits += 1
            else:
                self._misses += 1
            # Mejor jugada
            if self._best_move is None or points > self._best_move[1]:
                try:
                    player_san = self.board.san(move)
                except Exception:
                    player_san = player_uci
                self._best_move = (player_san, points)
            return points, label, top3_san, top3_scores, needs_bg

        if is_gm and is_engine1:
            return _record(12, f"¡PERFECTO! GM y módulo coinciden: {gm_san}", top3_san, top3_scores, False)
        if is_engine1:
            return _record(10, f"¡Mejor del módulo! GM jugó {gm_san}", top3_san, top3_scores, False)
        if is_gm:
            return _record(8, f"¡ACERTADO con GM! El módulo prefería otra. GM jugó {gm_san}", top3_san, top3_scores, False)

        if len(best_info) >= 2 and best_info[0][2] is not None:
            score1 = best_info[0][2]
            for rank, (eng_uci, eng_san, eng_score) in enumerate(best_info[1:], start=2):
                if player_uci == eng_uci and eng_score is not None:
                    diff = abs(score1 - eng_score)
                    base = f"Jugada #{rank} del módulo · GM jugó {gm_san}"
                    if diff < 25:
                        return _record(4, f"¡Casi perfecta! {base}", top3_san, top3_scores, False)
                    if diff < 50:
                        return _record(3, f"Muy cercana. {base}", top3_san, top3_scores, False)
                    if diff < 100:
                        return _record(2, f"Aceptable. {base}", top3_san, top3_scores, False)
                    return _record(0, f"Demasiado inferior. {base}", top3_san, top3_scores, False)

        return _record(0, f"Fallaste. GM jugó {gm_san}", top3_san, top3_scores, True)

    async def handle_move(self, player, uci_move, clients):
        if self.current_turn >= len(self.pgn_moves):
            await player.ws.send_text("feedback:fail|Partida ya terminada||0")
            return
        try:
            move = chess.Move.from_uci(uci_move)
        except Exception:
            await player.ws.send_text("feedback:fail|Movimiento inválido||0")
            return

        played_turn      = self.current_turn
        board_fen_before = self.board.fen()
        total_moves      = len(self.pgn_moves)

        points, feedback, top3_san, top3_scores, needs_bg_eval = \
            self.calculate_points(move, played_turn)
        player.score += points

        self.board.push(self.pgn_moves[played_turn])
        self.current_turn += 1

        top3_feedback = "|".join(
            f"{san} ({score/100:+.2f})"
            for san, score in zip(top3_san, top3_scores)
        ) if top3_san else ""

        await player.ws.send_text(
            f"feedback:{'success' if points > 0 else 'fail'}"
            f"|{feedback}|{top3_feedback}|{points}"
        )
        await player.ws.send_text(f"score:{player.score}")
        await player.ws.send_text(f"fen:{self.board.fen()}")
        # Progreso de la partida
        await player.ws.send_text(
            f"game_progress:{self.current_turn}|{total_moves}")

        if self.current_turn < total_moves:
            await player.ws.send_text(
                f"turno:Adivina jugada {self.current_turn + 1} de {total_moves}")
        else:
            summary = self.get_summary(player.score)
            await player.ws.send_text(f"gameover:{json.dumps(summary)}")

        if needs_bg_eval and self.stockfish.engine:
            asyncio.create_task(
                self._send_bg_eval(player.ws, board_fen_before, move.uci()))