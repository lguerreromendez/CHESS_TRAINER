from starlette.websockets import WebSocketDisconnect


class Lobby:
    def __init__(self, lobby_id):
        self.id = lobby_id
        self.players = {}
        self.scores = {}
        self.game = None
        self.timer_task = None
        self.submitted = set()

    def add_player(self, player):
        self.players[player.id] = player
        self.scores[player.id] = player.score
        print(f"[LOBBY {self.id}] Jugador añadido: {player.display_name}")

    def remove_player(self, player):
        if player.id in self.players:
            del self.players[player.id]
            del self.scores[player.id]
            self.submitted.discard(player.id)
            print(f"[LOBBY {self.id}] Jugador removido: {player.display_name}")
            # También limpiar del submitted del multi_game si existe
            if hasattr(self, 'multi_game') and self.multi_game:
                self.multi_game.submitted_this_turn.discard(player.id)

    async def broadcast(self, message: str):
        dead = []
        for pid, p in list(self.players.items()):
            try:
                await p.ws.send_text(message)
            except Exception:
                dead.append(pid)
        # Limpiar conexiones muertas detectadas durante el broadcast
        for pid in dead:
            if pid in self.players:
                print(f"[LOBBY {self.id}] Limpiando conexión muerta: "
                      f"{self.players[pid].display_name}")
                del self.players[pid]
                self.scores.pop(pid, None)
                self.submitted.discard(pid)

    async def update_and_broadcast_scores(self):
        ranking = sorted(
            [(p.display_name, self.scores.get(pid, 0))
             for pid, p in self.players.items()],
            key=lambda x: x[1], reverse=True
        )
        msg = "ranking:" + "|".join(
            f"{name}:{score}" for name, score in ranking)
        await self.broadcast(msg)
        await self.broadcast(f"player_count:{len(self.players)}")