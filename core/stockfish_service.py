# core/stockfish_service.py
import os
import platform
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

import chess.engine

CREATE_NO_WINDOW = 0x08000000


DEFAULT_STOCKFISH_URL = (
    "https://github.com/official-stockfish/Stockfish/releases/latest/download/"
    "stockfish-windows-x86-64-avx2.zip"
)
MIN_ZIP_SIZE = 150_000


def get_project_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.argv[0]).resolve().parent
    return Path(__file__).resolve().parent.parent


def get_runtime_data_root() -> Path:
    if getattr(sys, "frozen", False):
        appdata = os.getenv("LOCALAPPDATA") or os.getenv("APPDATA")
        if appdata:
            root = Path(appdata) / "ChessTrainer"
        else:
            root = Path.home() / ".chesstrainer"
        root.mkdir(parents=True, exist_ok=True)
        return root
    return get_project_root()


class StockfishService:
    def __init__(self, path=None):
        self.project_root = get_project_root()
        self.runtime_root = get_runtime_data_root()

        if path:
            self.engine_path = Path(path)
        else:
            self.engine_path = self._resolve_engine_path()

        self._load_engine()

    def _resolve_engine_path(self) -> Path:
        candidate_paths = [
            self.project_root / "stockfish.exe",
            self.project_root / "stockfish" / "stockfish.exe",
            self.project_root / "bin" / "stockfish.exe",
            self.runtime_root / "stockfish.exe",
            Path(sys.argv[0]).resolve().parent / "stockfish.exe",
        ]

        for candidate in candidate_paths:
            if candidate.exists():
                return candidate

        return self._prepare_stockfish()

    def _prepare_stockfish(self) -> Path:
        if platform.system() != "Windows":
            system_sf = shutil.which("stockfish")
            if system_sf:
                return Path(system_sf)
            return self.project_root / "stockfish"

        target_path = self.runtime_root / "stockfish.exe"
        if not target_path.exists():
            self._download_stockfish(target_path)
        return target_path

    def _download_stockfish(self, target_path: Path):
        zip_path = self.runtime_root / "stockfish.zip"
        try:
            self._download_file(DEFAULT_STOCKFISH_URL, zip_path)
            self._extract_executable_from_zip(zip_path, target_path)
        finally:
            try:
                zip_path.unlink()
            except FileNotFoundError:
                pass

    def _download_file(self, url: str, dest_path: Path):
        print(f"[STOCKFISH] Descargando Stockfish desde {url}")
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                if response.status != 200:
                    raise RuntimeError(f"HTTP {response.status}")
                with dest_path.open("wb") as out_file:
                    shutil.copyfileobj(response, out_file)
        except Exception as exc:
            raise RuntimeError(f"No se pudo descargar Stockfish: {exc}") from exc

        size = dest_path.stat().st_size
        if size < MIN_ZIP_SIZE:
            raise RuntimeError(
                f"Descarga inválida: zip demasiado pequeño ({size} bytes)"
            )

    def _extract_executable_from_zip(self, zip_path: Path, engine_path: Path):
        print(f"[STOCKFISH] Extrayendo {zip_path}")
        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                candidates = [
                    name for name in zf.namelist() if name.lower().endswith(".exe")
                ]
                if not candidates:
                    raise RuntimeError("El ZIP no contiene ejecutable .exe")
                executable_name = candidates[0]
                engine_path.parent.mkdir(parents=True, exist_ok=True)
                with engine_path.open("wb") as out_file:
                    out_file.write(zf.read(executable_name))
                engine_path.chmod(0o755)
                print(f"[STOCKFISH] Guardado en {engine_path}")
        except zipfile.BadZipFile as exc:
            raise RuntimeError(f"Zip corrupto: {exc}") from exc

    def _load_engine(self):
        try:
            self.engine = chess.engine.SimpleEngine.popen_uci(
                str(self.engine_path), creationflags=CREATE_NO_WINDOW
            )
            self.engine.configure({"Threads": 2, "Hash": 128})
            print(f"Stockfish cargado: {self.engine.id['name']} ({self.engine_path})")
        except Exception as e:
            print(f"Error cargando Stockfish desde {self.engine_path}: {e}")
            self.engine = None

    def analyze(self, board, depth=16):
        if not self.engine:
            return []
        info = self.engine.analyse(board, chess.engine.Limit(depth=depth), multipv=3)
        result = []
        for pv in info[:3]:
            if pv.get("pv"):
                result.append(pv)
        return result

    def quit(self):
        if self.engine:
            self.engine.quit()
