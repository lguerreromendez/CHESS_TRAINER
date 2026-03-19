# core/player.py
import uuid

class Player:
    def __init__(self, ws, name=None, uid=None):
        self.id = str(uuid.uuid4())
        self.name = name or f"Jugador-{self.id[:5]}"
        self.display_name = name or "Anónimo"          # ← puedes renombrar o mantener
        self.uid = uid                                 # ← nuevo campo
        self.score = 0
        self.mode = "local"
        self.ws = ws
        self.lobby_id = None