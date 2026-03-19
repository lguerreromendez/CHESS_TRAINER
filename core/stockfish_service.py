# core/stockfish_service.py
import chess.engine
from pathlib import Path
import platform
import shutil


class StockfishService:
    def __init__(self, path=None):
        if path:
            self.engine_path = Path(path)
        elif platform.system() == "Windows":
            # Local Windows: ejecutable en la raíz del proyecto
            self.engine_path = Path(__file__).parent.parent / "stockfish.exe"
        else:
            # Linux (Railway u otro servidor): instalado por nixpacks
            system_sf = shutil.which("stockfish")
            if system_sf:
                self.engine_path = Path(system_sf)
            else:
                # Fallback: raíz del proyecto (por si se sube un binario Linux)
                self.engine_path = Path(__file__).parent.parent / "stockfish"

        try:
            self.engine = chess.engine.SimpleEngine.popen_uci(str(self.engine_path))
            self.engine.configure({"Threads": 2, "Hash": 128})
            print(f"Stockfish cargado: {self.engine.id['name']} ({self.engine_path})")
        except Exception as e:
            print(f"Error cargando Stockfish desde {self.engine_path}: {e}")
            self.engine = None

    def analyze(self, board, depth=16):
        if not self.engine:
            return []
        info = self.engine.analyse(
            board, chess.engine.Limit(depth=depth), multipv=3)
        result = []
        for pv in info[:3]:
            if pv.get("pv"):
                result.append(pv)
        return result

    def quit(self):
        if self.engine:
            self.engine.quit()