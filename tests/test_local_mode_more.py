import chess

import modes.local_mode as local_mode


class DummyStockfish:
    def __init__(self, *args, **kwargs):
        self.engine = None

    def analyze(self, board, depth=16):
        return []


def test_get_top3_str_and_calculate_points(monkeypatch):
    monkeypatch.setattr(
        local_mode, "get_shared_stockfish_service", lambda: DummyStockfish()
    )

    lm = local_mode.LocalMode(auto_load=False)
    # prepare moves: 1. e4 e5
    m1 = chess.Move.from_uci("e2e4")
    m2 = chess.Move.from_uci("e7e5")
    lm.pgn_moves = [m1, m2]
    # stockfish_best: for turn 0 provide top3
    lm.stockfish_best = [
        [("e2e4", "e4", 100), ("d2d4", "d4", 50), ("g1f3", "Nf3", 20)],
        [("e7e5", "e5", 100)],
    ]
    lm.board = chess.Board()

    # get_top3_str
    s = lm.get_top3_str(0)
    assert "e4" in s and "(+1.00)" in s

    # calculate_points: play exactly the GM move
    points, label, top3_san, top3_scores, needs_bg = lm.calculate_points(m1, 0)
    assert points == 12
    assert "PERFECTO" in label or "PERFECTO" in label.upper()


def test_calculate_points_fixed_top3_and_gm_outside_top3(monkeypatch):
    monkeypatch.setattr(
        local_mode, "get_shared_stockfish_service", lambda: DummyStockfish()
    )

    lm = local_mode.LocalMode(auto_load=False)
    gm_move = chess.Move.from_uci("e2e4")
    top2_move = chess.Move.from_uci("d2d4")
    lm.pgn_moves = [gm_move]
    lm.stockfish_best = [
        [
            ("g1f3", "Nf3", 100),
            ("d2d4", "d4", 80),
            ("c2c4", "c4", 60),
        ]
    ]
    lm.board = chess.Board()

    points_top2, label_top2, *_ = lm.calculate_points(top2_move, 0)
    assert points_top2 == 6
    assert "#2" in label_top2 or "2" in label_top2

    points_gm, label_gm, *_ = lm.calculate_points(gm_move, 0)
    assert points_gm == 2
    assert "FUERA DEL TOP 3" in label_gm.upper()
