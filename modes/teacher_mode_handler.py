# modes/teacher_mode_handler.py
import json
import chess
from fastapi import WebSocket, WebSocketDisconnect
from core.player import Player
from modes.multiplayer_mode import MultiplayerGame
import asyncio

async def handle_teacher_mode(
    ws: WebSocket,
    firebase_user,
    lobby_id_param: str | None,
    lobby_manager
):
    if not lobby_id_param:
        await ws.send_text("error:Se requiere lobby_id para modo profesor")
        await ws.close(code=1008)
        return

    player = Player(ws, name=firebase_user.email)
    player.uid = firebase_user.uid
    player.display_name = firebase_user.email.split('@')[0]

    # Aquí deberías verificar si es profesor (puedes usar un campo en Firestore)
    # Por ahora lo dejamos abierto para pruebas

    lobby = lobby_manager.get_lobby(lobby_id_param)
    if not lobby:
        await ws.send_text("error:Lobby no encontrado")
        await ws.close(code=1008)
        return

    lobby.add_player(player)

    if not hasattr(lobby, "multi_game") or lobby.multi_game is None:
        lobby.multi_game = MultiplayerGame(lobby)
        # NO iniciamos timer automático → el profesor controla

    current_fen = lobby.multi_game.game.board.fen()
    await ws.send_text(f"fen:{current_fen}")
    await ws.send_text(f"turno:Modo Profesor - Controlas la partida")
    await ws.send_text(f"score:{player.score}")
    await ws.send_text(f"lobby_id:{lobby_id_param}")

    try:
        while True:
            data = await ws.receive_text()
            print(f"[TEACHER {player.display_name}] {data}")

            if data.startswith("advance"):
                await lobby.multi_game.advance_turn()
                await ws.send_text("feedback:success|Partida avanzada manualmente")

            elif data.startswith("move:"):
                # Permitir que el profesor también pruebe movimientos (opcional)
                uci = data[5:].strip()
                points, feedback = await lobby.multi_game.register_move(player.id, uci)
                player.score += points
                lobby.scores[player.id] = player.score
                await ws.send_text(f"score:{player.score}")
                await ws.send_text(f"feedback:info|{feedback} (+{points})")
                await lobby.update_and_broadcast_scores()

            # Puedes agregar más comandos: set_correct_move:, award_points:uid:pts, etc.

    except WebSocketDisconnect:
        lobby.remove_player(player)
        await lobby.broadcast(f"player_left:{player.display_name}")
    except asyncio.CancelledError:
        print(f"[TEACHER CANCELLED] {player.display_name} cancelado")
        lobby.remove_player(player)
        raise
    except Exception as e:
        print(f"[TEACHER ERROR] {player.display_name}: {e}")
        lobby.remove_player(player)