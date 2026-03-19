# modes/multiplayer_mode_handler.py
import asyncio
import json
import io
import chess.pgn
from fastapi import WebSocket, WebSocketDisconnect
from core.player import Player
from .multiplayer_mode import MultiplayerGame, _analysis_executor


async def handle_multiplayer_mode(
    ws: WebSocket,
    firebase_user,
    lobby_id_param: str | None,
    lobby_manager
):
    player = Player(ws, name=firebase_user.email)
    player.uid          = firebase_user.uid
    player.display_name = firebase_user.email.split('@')[0]

    lobby_id = lobby_id_param or "default"
    lobby    = lobby_manager.get_lobby(lobby_id)
    if not lobby:
        await ws.send_text("error:Lobby no encontrado")
        await ws.close(code=1008)
        return

    lobby.add_player(player)

    is_private = getattr(lobby, 'is_private', False)
    is_owner   = is_private and lobby.owner_uid == player.uid

    try:
        await ws.send_text(f"lobby_id:{lobby_id}")
        await ws.send_text(f"lobby_role:{'owner' if is_owner else 'guest'}")
        await ws.send_text(f"lobby_type:{'private' if is_private else 'default'}")

        # Nombre del owner para mostrar a guests
        owner_name = None
        if is_private:
            for p in lobby.players.values():
                if p.uid == lobby.owner_uid:
                    owner_name = p.display_name
                    break

        if lobby.multi_game and lobby.multi_game.started:
            await _send_current_state(ws, lobby)
        elif lobby.multi_game and not lobby.multi_game.started:
            await ws.send_text(f"fen:{lobby.multi_game.game.board.fen()}")
            total = len(lobby.multi_game.game.pgn_moves)
            if total > 0:
                await ws.send_text(f"turno:Adivina jugada 1 de {total}")
                who = owner_name or "el admin"
                await ws.send_text(
                    f"lobby_waiting:Partida lista · Esperando a que {who} inicie")
                await ws.send_text("owner_ready:1")
            else:
                who = owner_name or "el admin"
                await ws.send_text(
                    f"lobby_waiting:Esperando a que {who} cargue una partida…")
        else:
            who = owner_name or "el admin"
            await ws.send_text(
                f"lobby_waiting:Esperando a que {who} cargue una partida…")

        # Tiempo por jugada configurado
        if lobby.multi_game:
            await ws.send_text(
                f"turn_seconds:{lobby.multi_game.turn_seconds}")

        await lobby.update_and_broadcast_scores()
    except (WebSocketDisconnect, Exception) as e:
        print(f"[MP] {player.display_name} desconectado en init: {type(e).__name__}")
        lobby.remove_player(player)
        return

    print(f"[MP] {player.display_name} → {lobby_id} "
          f"({'owner' if is_owner else 'guest'})")

    try:
        while True:
            data = await ws.receive_text()

            if data.startswith("{"):
                try:
                    info = json.loads(data)
                    if info.get("type") == "user_info":
                        player.display_name = info.get(
                            "displayName", player.display_name)
                        await lobby.broadcast(
                            f"player_joined:{player.display_name}")
                        await lobby.update_and_broadcast_scores()
                except Exception as e:
                    print(f"[USER INFO ERROR] {e}")

            elif data.startswith("move:"):
                if not lobby.multi_game:
                    await ws.send_text(
                        "feedback:fail|El dueño aún no cargó una partida||0|—")
                    continue
                if is_private and not lobby.multi_game.started:
                    await ws.send_text(
                        "feedback:fail|Espera a que el admin inicie||0|—")
                    continue
                uci = data[5:].strip()
                points, _ = await lobby.multi_game.register_move(
                    ws, player.id, uci)
                player.score             += points
                lobby.scores[player.id]   = player.score
                global_pts = lobby.multi_game.global_scores.get(player.id, 0) + player.score
                await ws.send_text(f"score:{player.score}|{global_pts}")
                await lobby.update_and_broadcast_scores()

            elif data.startswith("load_pgn:"):
                if not is_owner:
                    await ws.send_text(
                        "feedback:fail|Solo el dueño puede cargar partidas||0")
                    continue
                payload  = data[9:].strip()
                depth    = 16
                pgn_text = payload
                if payload.startswith("depth="):
                    sep = payload.index("|")
                    try:
                        depth = int(payload[6:sep])
                    except Exception:
                        depth = 16
                    pgn_text = payload[sep + 1:].strip()
                if not pgn_text:
                    await ws.send_text("feedback:fail|PGN vacío||0")
                    continue
                await _owner_load_pgn(ws, lobby, pgn_text, depth=depth)

            elif data == "owner_start":
                if is_owner and lobby.multi_game and not lobby.multi_game.started:
                    await lobby.multi_game.start_timer()
                    await lobby.broadcast("owner_started:1")
                    await lobby.multi_game.advance_turn()

            elif data == "owner_pause":
                if is_owner and lobby.multi_game:
                    await lobby.multi_game.pause()

            elif data == "owner_resume":
                if is_owner and lobby.multi_game:
                    await lobby.multi_game.resume()

            elif data == "owner_advance":
                if is_owner and lobby.multi_game:
                    await lobby.multi_game.advance_turn()

            elif data.startswith("set_time:"):
                if is_owner:
                    try:
                        secs = int(data[9:].strip())
                        secs = max(5, min(secs, 120))
                        if lobby.multi_game:
                            lobby.multi_game.turn_seconds = secs
                        else:
                            lobby.turn_seconds = secs
                        await lobby.broadcast(f"turn_seconds:{secs}")
                        await ws.send_text(
                            f"feedback:info|Tiempo por jugada: {secs}s||0")
                    except Exception:
                        pass

            elif data == "owner_delete":
                if is_owner:
                    deleted = await lobby_manager.delete_lobby(
                        lobby_id, player.uid)
                    if deleted:
                        return  # lobby_manager.delete_lobby ya cerró las ws

            elif data.startswith("chat:"):
                if is_private:
                    msg_text = data[5:].strip()[:200]
                    if msg_text:
                        await lobby.broadcast(
                            f"chat:{player.display_name}|{msg_text}")

            else:
                print(f"[MP UNKNOWN] {player.display_name}: {data[:60]}")

    except WebSocketDisconnect:
        lobby.remove_player(player)
        await lobby.broadcast(f"player_left:{player.display_name}")
        await lobby.update_and_broadcast_scores()
        print(f"[MP DISCONNECT] {player.display_name}")

    except asyncio.CancelledError:
        try:
            lobby.remove_player(player)
        except Exception:
            pass
        raise

    except Exception as e:
        print(f"[MP ERROR] {player.display_name}: {type(e).__name__}: {e}")
        try:
            lobby.remove_player(player)
        except Exception:
            pass


async def _send_current_state(ws, lobby):
    mg = lobby.multi_game
    if not mg:
        return
    if mg.current_pgn_text:
        await ws.send_text(f"pgn:{mg.current_pgn_text}")
        try:
            g = chess.pgn.read_game(io.StringIO(mg.current_pgn_text))
            if g:
                await ws.send_text(
                    f"pgn_info:{json.dumps(dict(g.headers))}")
        except Exception:
            pass
    total = len(mg.game.pgn_moves)
    await ws.send_text(f"fen:{mg.game.board.fen()}")
    await ws.send_text(
        f"turno:Adivina jugada {mg.game.current_turn + 1} de {total}")
    await ws.send_text("score:0")
    await ws.send_text(f"next_advance:{mg.next_advance_ts}")
    await ws.send_text(f"game_progress:{mg.game.current_turn}|{total}")


async def _owner_load_pgn(ws, lobby, pgn_text: str, depth: int = 16):
    await lobby.broadcast("game_transition:start")
    await lobby.broadcast("status:Cargando partida con Stockfish…")

    if lobby.multi_game is None:
        turn_secs = getattr(lobby, 'turn_seconds', 10)
        lobby.multi_game = MultiplayerGame(lobby, turn_seconds=turn_secs)

    mg = lobby.multi_game
    if mg.advance_handle:
        mg.advance_handle.cancel()
        mg.advance_handle = None
    mg.started = False
    mg.player_stats = {}

    try:
        g = chess.pgn.read_game(io.StringIO(pgn_text))
        if g:
            await lobby.broadcast(f"pgn_info:{json.dumps(dict(g.headers))}")
    except Exception:
        pass

    loop = asyncio.get_event_loop()
    progress_queue: asyncio.Queue = asyncio.Queue()

    def progress_cb(current, total):
        loop.call_soon_threadsafe(
            progress_queue.put_nowait, (current, total))

    future = loop.run_in_executor(
        _analysis_executor,
        lambda: mg.game.load_pgn_and_analyze(pgn_text, depth=depth,
                                              progress_cb=progress_cb))

    while not future.done():
        try:
            c, t = await asyncio.wait_for(progress_queue.get(), timeout=0.2)
            await lobby.broadcast(f"analysis_progress:{c}|{t}")
        except asyncio.TimeoutError:
            pass
        except Exception:
            break

    while not progress_queue.empty():
        try:
            c, t = progress_queue.get_nowait()
            await lobby.broadcast(f"analysis_progress:{c}|{t}")
        except Exception:
            break

    await future

    mg.current_pgn_text    = pgn_text
    mg.submitted_this_turn = set()

    # Resetear scores de partida (no el global)
    for pid in list(lobby.players.keys()):
        lobby.scores[pid] = 0
        p = lobby.players.get(pid)
        if p:
            p.score = 0
    # Notificar a todos del reset
    await lobby.broadcast("score_reset:1")

    await lobby.broadcast("analysis:complete")
    await lobby.broadcast(f"pgn:{pgn_text}")

    total = len(mg.game.pgn_moves)
    await lobby.broadcast(f"fen:{mg.game.board.fen()}")
    await lobby.broadcast(f"turno:Adivina jugada 1 de {total}")
    await lobby.broadcast(f"turn_seconds:{mg.turn_seconds}")

    await ws.send_text("feedback:success|Partida lista · pulsa Iniciar||0")
    await lobby.broadcast("owner_ready:1")