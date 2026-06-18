# core/stockfish_service.py
import chess.engine
from pathlib import Path
import platform
import shutil
import zipfile


class StockfishService:
    def __init__(self, path=None):
        project_root = Path(__file__).parent.parent

        if path:
            self.engine_path = Path(path)
        elif platform.system() == "Windows":
            # Local Windows: ejecutable en la raíz del proyecto
            self.engine_path = project_root / "stockfish.exe"
            if not self.engine_path.exists():
                self._extract_windows_from_zip(project_root)
        else:
            # Linux (Railway u otro servidor): instalado por nixpacks
            system_sf = shutil.which("stockfish")
            if system_sf:
                self.engine_path = Path(system_sf)
            else:
                # Fallback: raíz del proyecto (por si se sube un binario Linux)
                self.engine_path = project_root / "stockfish"

        self._load_engine()

    def _extract_windows_from_zip(self, project_root: Path):
        zip_path = project_root / "stockfish.zip"
        if not zip_path.exists():
            return
        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                candidates = [name for name in zf.namelist()
                              if name.lower().endswith('.exe')]
                if not candidates:
                    print(f"stockfish.zip encontrado, pero no contiene .exe")
                    return
                # Prefer the first executable file in the archive
                exe_name = candidates[0]
                self.engine_path = project_root / "stockfish.exe"
                with self.engine_path.open('wb') as out_f:
                    out_f.write(zf.read(exe_name))
                print(f"Extraído Stockfish desde {zip_path} -> {self.engine_path}")
        except Exception as e:
            print(f"Error extrayendo Stockfish desde {zip_path}: {e}")

    def _load_engine(self):
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