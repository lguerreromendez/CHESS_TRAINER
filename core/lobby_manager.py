import asyncio
import random
import string
from core.lobby import Lobby
from modes.multiplayer_mode import MultiplayerGame


def _short_id(length=6) -> str:
    chars = string.ascii_uppercase + string.digits
    return ''.join(random.choices(chars, k=length))


class LobbyManager:
    def __init__(self):
        self.lobbies = {}

    def create_default_lobby(self):
        if "default" in self.lobbies:
            return self.lobbies["default"]
        lobby = Lobby("default")
        lobby.is_private = False
        lobby.owner_uid  = None
        lobby.multi_game = MultiplayerGame(lobby)
        asyncio.create_task(lobby.multi_game.start_timer())
        self.lobbies["default"] = lobby
        print(f"[LOBBY] Default listo con {len(lobby.multi_game.pgn_list)} PGNs")
        return lobby

    def create_private_lobby(self, owner_uid: str,
                              turn_seconds: int = 10) -> Lobby:
        for _ in range(10):
            lid = _short_id()
            if lid not in self.lobbies:
                break
        lobby = Lobby(lid)
        lobby.is_private   = True
        lobby.owner_uid    = owner_uid
        lobby.multi_game   = None
        lobby.turn_seconds = turn_seconds
        self.lobbies[lid]  = lobby
        print(f"[LOBBY] Privado creado: {lid} (owner={owner_uid}, {turn_seconds}s/jugada)")
        return lobby

    def get_lobby(self, lobby_id: str):
        return self.lobbies.get(lobby_id)

    async def delete_lobby(self, lobby_id: str, owner_uid: str) -> bool:
        """Elimina un lobby privado. Solo el owner puede hacerlo."""
        lobby = self.lobbies.get(lobby_id)
        if not lobby:
            return False
        if lobby_id == "default":
            return False
        if getattr(lobby, 'owner_uid', None) != owner_uid:
            return False
        # Avisar a todos los jugadores y cerrar sus conexiones
        if lobby.multi_game:
            await lobby.multi_game.cleanup()
        try:
            await lobby.broadcast("lobby_closed:El admin ha cerrado el lobby")
        except Exception:
            pass
        del self.lobbies[lobby_id]
        print(f"[LOBBY] Eliminado: {lobby_id}")
        return True