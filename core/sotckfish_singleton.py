from core.stockfish_service import StockfishService

_instance = None

def get_stockfish():
    global _instance
    if _instance is None:
        _instance = StockfishService()
    return _instance