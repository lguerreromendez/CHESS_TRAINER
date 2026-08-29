import io

import chess
import chess.pgn

import modes.local_mode as local_mode


class DummyStockfish:
    def __init__(self, *args, **kwargs):
        self.engine = None

    def analyze(self, board, depth=16):
        # Return empty best-lines so analysis steps are skipped safely
        return []


def parse_moves_from_pgn(pgn_text):
    game = chess.pgn.read_game(io.StringIO(pgn_text))
    moves = []
    node = game
    while node.variations:
        node = node.variation(0)
        moves.append(node.move)
    return moves


def test_get_opening_pieces_basic(monkeypatch):
    # Replace shared Stockfish service with dummy to avoid external engine dependency
    monkeypatch.setattr(
        local_mode, "get_shared_stockfish_service", lambda: DummyStockfish()
    )

    pgn = """
    [Event "Test"]
    1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7
    """

    moves = parse_moves_from_pgn(pgn)

    lm = local_mode.LocalMode(auto_load=False)
    lm.pgn_moves = moves

    opening = lm.get_opening_pieces(n=5)

    # Basic structure checks
    assert isinstance(opening, dict)
    assert "white" in opening and "black" in opening
    assert len(opening["white"]) == 5
    assert len(opening["black"]) == 5

    # First white move should be e4 from e2
    first_white = opening["white"][0]
    assert first_white["piece"] == "Peón"
    assert first_white["from"] in ("e2",)  # depending on chess version
    assert first_white["san"] in ("e4", "e4+")

    # First black move should be e5 from e7
    first_black = opening["black"][0]
    assert first_black["piece"] == "Peón"
    assert first_black["from"] in ("e7",)
    assert first_black["san"] in ("e5", "e5+")
