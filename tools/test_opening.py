# Test script to verify opening pieces extraction without loading Stockfish
from modes import local_mode


class DummySF:
    def __init__(self, *a, **k):
        self.engine = None

    def analyze(self, board, depth=16):
        return []


def main():
    # Monkeypatch StockfishService to avoid downloads
    local_mode.StockfishService = DummySF

    lm = local_mode.LocalMode(auto_load=False)
    pgn = '[Event "Test"]\n' "\n" "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7"
    lm.load_pgn_and_analyze(pgn, depth=8)
    print("Opening pieces:", lm.get_opening_pieces())


if __name__ == "__main__":
    main()
