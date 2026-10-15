"""
Meme Card Game - Flask Backend với SocketIO
"""
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room
from game_engine import Game, GameState, REJECT_DRAW, SETTING_CHOICES
from topics import TOPIC_SUGGESTIONS
from card_deck import SOUND_DIR, SOUND_EXTS, find_asset
import os
import threading
import uuid

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'meme-card-game-secret')
socketio = SocketIO(app,
                    cors_allowed_origins="*",
                    async_mode='threading',
                    logger=False,
                    engineio_logger=False,
                    transports=['polling'],
                    ping_interval=10,
                    ping_timeout=5)

# Lưu trữ các game
games = {}
player_to_game = {}  # Ánh xạ player_id -> game_id

# Server chạy đa luồng: mọi thay đổi trạng thái game đi qua lock này,
# tránh 2 phiếu cuối tới cùng lúc làm chốt kết quả 2 lần
game_lock = threading.RLock()

MAX_NAME_LENGTH = 20
LOBBY_DELAY = 8  # Hết ván bao nhiêu giây thì cả phòng quay về phòng chờ

# Âm thanh giao diện; thiếu file thì client tự phát tiếng bíp tổng hợp
UI_SOUNDS = ('card-play', 'vote', 'accept', 'reject', 'tick', 'win', 'your-turn',
             'your-topic', 'deal', 'drumroll', 'topic')
# Mỗi âm thanh có thể có thêm bản phụ <tên>-2, <tên>-3 để phát ngẫu nhiên cho đỡ nhàm
SOUND_VARIANTS = ('', '-2', '-3')

def find_ui_sounds():
    ui_sounds = {}
    for name in UI_SOUNDS:
        found = [find_asset(SOUND_DIR, name + suffix, SOUND_EXTS) for suffix in SOUND_VARIANTS]
        ui_sounds[name] = [f'/static/sounds/{f}' for f in found if f]
    return ui_sounds

@app.route('/')
def index():
    return render_template('index.html', ui_sounds=find_ui_sounds(),
                           topic_suggestions=TOPIC_SUGGESTIONS)

# ==================== SocketIO Events ====================

@socketio.on('connect')
def handle_connect():
    print(f'Player connected: {request.sid}')

@socketio.on('disconnect')
def handle_disconnect():
    with game_lock:
        remove_player_from_game(request.sid)
    print(f'Player disconnected: {request.sid}')

@socketio.on('leave_game')
def handle_leave_game():
    """Người chơi chủ động rời phòng"""
    with game_lock:
        remove_player_from_game(request.sid)

@socketio.on('create_game')
def handle_create_game(data):
    """Tạo một game mới"""
    player_id = request.sid
    player_name = clean_name(data, player_id)

    with game_lock:
        # Đang ở phòng khác thì rời phòng đó trước
        remove_player_from_game(player_id)

        game_id = str(uuid.uuid4())[:8]
        while game_id in games:
            game_id = str(uuid.uuid4())[:8]

        game = Game(game_id, max_players=8)
        game.add_player(player_id, player_name)

        games[game_id] = game
        player_to_game[player_id] = game_id

        join_room(game_id)

        emit('game_created', {
            'game_id': game_id,
            'player_id': player_id,
            'message': f'Game được tạo: {game_id}'
        })

        emit_game_state_to_room(game_id)

@socketio.on('join_game')
def handle_join_game(data):
    """Tham gia vào một game"""
    player_id = request.sid
    game_id = normalize_game_id((data or {}).get('game_id'))
    player_name = clean_name(data, player_id)

    with game_lock:
        if game_id not in games:
            emit('error', {'message': f'Game {game_id.upper()} không tồn tại'})
            return

        if player_to_game.get(player_id) == game_id:
            emit('error', {'message': 'Bạn đã ở trong game này rồi'})
            return

        game = games[game_id]

        if game.headcount() >= game.max_players:
            emit('error', {'message': 'Game đã đầy'})
            return

        remove_player_from_game(player_id)
        # Phòng đang chơi thì ngồi chờ, hết ván sẽ được vào chơi
        spectating = game.state != GameState.WAITING
        if spectating:
            game.add_spectator(player_id, player_name)
        else:
            game.add_player(player_id, player_name)

        player_to_game[player_id] = game_id
        join_room(game_id)

        message = (f'{player_name} đã vào phòng, sẽ chơi từ ván sau' if spectating
                   else f'{player_name} đã tham gia game')
        emit('game_joined', {
            'game_id': game_id,
            'player_id': player_id,
            'spectating': spectating,
            'message': message
        })
        emit_to_room(game_id, 'notification', {'message': message})

        emit_game_state_to_room(game_id)

@socketio.on('start_game')
def handle_start_game():
    """Bắt đầu game (chỉ chủ phòng)"""
    player_id = request.sid
    with game_lock:
        game = get_player_game(player_id)
        if game is None:
            return

        if game.host_id != player_id:
            emit('error', {'message': 'Chỉ chủ phòng mới được bắt đầu game'})
            return

        if game.start_game():
            emit_game_state_to_room(game.game_id)
            first = game.get_current_player()
            emit_to_room(game.game_id, 'notification', {
                'message': f'Game bắt đầu! {first.name}, hãy ra chủ đề cho vòng 1'
            })
        else:
            emit('error', {'message': 'Không thể bắt đầu game. Cần ít nhất 2 người chơi'})

@socketio.on('update_settings')
def handle_update_settings(data):
    """Chủ phòng chỉnh thời gian chọn ảnh / bỏ phiếu / ra đề và số vòng cho ván tiếp theo"""
    player_id = request.sid
    data = data or {}
    with game_lock:
        game = get_player_game(player_id)
        if game is None:
            return

        changes = {key: to_int(data.get(key)) for key in SETTING_CHOICES}
        if not game.update_settings(player_id, **changes):
            emit('error', {'message': 'Chỉ chủ phòng mới chỉnh được cài đặt, và chỉ khi đang ở phòng chờ'})
        emit_game_state_to_room(game.game_id)

@socketio.on('set_topic')
def handle_set_topic(data):
    """Người mở vòng ra chủ đề"""
    player_id = request.sid
    with game_lock:
        game = get_player_game(player_id)
        if game is None:
            return

        if game.set_topic(player_id, (data or {}).get('topic')):
            announce_topic(game)
            emit_game_state_to_room(game.game_id)
        else:
            emit('error', {'message': 'Không thể ra đề lúc này. Đề không được để trống'})

@socketio.on('play_card')
def handle_play_card(data):
    """Người chơi đánh bài"""
    player_id = request.sid
    with game_lock:
        game = get_player_game(player_id)
        if game is None:
            return

        card_index = (data or {}).get('card_index')

        if game.player_play_card(player_id, card_index):
            player = game.players[player_id]
            final_text = ' (LÁ CUỐI, chỉ cần 1/2 đồng ý!)' if game.current_card['is_final_card'] else ''
            emit_to_room(game.game_id, 'notification', {
                'message': f'{player.name} đã đánh 1 lá bài{final_text}. Bây giờ mọi người bình chọn!'
            })
            emit_game_state_to_room(game.game_id)
            socketio.start_background_task(vote_timer, game.game_id, game.voting_id,
                                           game.vote_seconds)
        else:
            emit('error', {'message': 'Không thể đánh bài. Đảm bảo đó là lượt của bạn'})

@socketio.on('vote')
def handle_vote(data):
    """Bỏ phiếu cho lá bài"""
    player_id = request.sid
    with game_lock:
        game = get_player_game(player_id)
        if game is None:
            return

        is_valid = bool((data or {}).get('is_valid', False))

        if game.player_vote(player_id, is_valid):
            player = game.players[player_id]
            emit_to_room(game.game_id, 'notification', {
                'message': f'{player.name} đã bỏ phiếu'
            })
            finish_voting_if_complete(game)
            emit_game_state_to_room(game.game_id)
        else:
            emit('error', {'message': 'Bạn không thể bỏ phiếu lúc này'})

@socketio.on('get_game_state')
def handle_get_game_state():
    """Lấy trạng thái game"""
    player_id = request.sid
    with game_lock:
        game = get_player_game(player_id)
        if game is None:
            return

        # Gửi game state với hand info cho player này
        emit('game_state', game.get_state_for_player(player_id))

@socketio.on('back_to_lobby')
def handle_back_to_lobby():
    """Chủ phòng cho cả phòng về phòng chờ ngay, không đợi hết giờ"""
    player_id = request.sid
    with game_lock:
        game = get_player_game(player_id)
        if game is None or game.host_id != player_id or game.state != GameState.GAME_END:
            return
        game.reset_to_lobby()
        emit_game_state_to_room(game.game_id)

# ==================== Utility Functions ====================

def normalize_game_id(raw):
    """Mã game do server tạo là chữ thường; người chơi có thể gõ HOA hoặc thừa khoảng trắng"""
    return str(raw or '').strip().lower()

def to_int(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return -1  # Giá trị lạ: để engine từ chối

def clean_name(data, player_id):
    name = str((data or {}).get('name') or '').strip()[:MAX_NAME_LENGTH]
    return name or f'Player {player_id[:4]}'

def get_player_game(player_id):
    """Lấy game của người chơi, báo lỗi nếu không ở trong game nào"""
    game = games.get(player_to_game.get(player_id))
    if game is None:
        emit('error', {'message': 'Bạn không ở trong game nào'})
    return game

def finish_voting_if_complete(game):
    """Khi mọi người đã bỏ phiếu xong thì chốt kết quả và báo cho cả phòng"""
    result = game.end_voting()
    if result is None:
        return

    vote_result = result['vote_result']
    validity_text = 'ĐƯỢC CHẤP NHẬN' if vote_result['is_valid'] else f'BỊ TỪ CHỐI, phạt rút {REJECT_DRAW} lá'
    emit_to_room(game.game_id, 'notification', {
        'message': f"Kết quả bỏ phiếu: {validity_text} ({vote_result['valid_votes']}/{vote_result['total_votes']})"
    })
    if game.state == GameState.GAME_END:
        announce_winner(game)
    elif game.state == GameState.TOPIC:
        opener = game.get_current_player()
        emit_to_room(game.game_id, 'notification', {
            'message': f'Vòng {game.current_round}! {opener.name}, hãy ra chủ đề mới'
        })

def announce_winner(game):
    winner = game.players.get(game.winner_id)
    if winner is None:
        return
    reasons = {
        'last_card': f'{winner.name} đã thắng với lá bài cuối!',
        'players_left': f'{winner.name} thắng vì những người khác đã rời game!',
        'rounds': f'Hết {game.max_rounds} vòng! {winner.name} thắng vì còn ít bài nhất ({len(winner.hand)} lá)',
    }
    emit_to_room(game.game_id, 'notification', {
        'message': f"🎉 {reasons.get(game.end_reason, winner.name + ' thắng!')}",
        'type': 'winner'
    })

def ensure_play_timer(game):
    """Mỗi lượt đánh hẹn giờ chọn ảnh đúng một lần"""
    if game.state == GameState.PLAYING and game.play_deadline is not None \
            and game.timed_turn_id != game.turn_id:
        game.timed_turn_id = game.turn_id
        socketio.start_background_task(play_timer, game.game_id, game.turn_id,
                                       game.play_time_left())

def play_timer(game_id, turn_id, seconds):
    """Hết giờ chọn ảnh thì người đó mất lượt để ván không bị kẹt"""
    socketio.sleep(seconds)
    with game_lock:
        game = games.get(game_id)
        if game is None:
            return
        skipped = game.expire_turn(turn_id)
        if skipped is None:
            return
        name = game.players[skipped].name if skipped in game.players else 'Ai đó'
        emit_to_room(game_id, 'notification', {
            'message': f'⏰ Hết giờ chọn ảnh, {name} mất lượt'
        })
        if game.state == GameState.GAME_END:
            announce_winner(game)
        elif game.state == GameState.TOPIC:
            opener = game.get_current_player()
            emit_to_room(game_id, 'notification', {
                'message': f'Vòng {game.current_round}! {opener.name}, hãy ra chủ đề mới'
            })
        emit_game_state_to_room(game_id)

def ensure_lobby_timer(game):
    """Hết ván thì hẹn giờ đưa cả phòng về phòng chờ, phòng không bị đóng"""
    if game.state == GameState.GAME_END and game.timed_lobby_id != game.game_number:
        game.timed_lobby_id = game.game_number
        socketio.start_background_task(lobby_timer, game.game_id, game.game_number)

def lobby_timer(game_id, game_number):
    socketio.sleep(LOBBY_DELAY)
    with game_lock:
        game = games.get(game_id)
        if game is None or game.state != GameState.GAME_END or game.game_number != game_number:
            return
        game.reset_to_lobby()
        emit_to_room(game_id, 'notification', {
            'message': 'Cả phòng đã về phòng chờ. Chủ phòng có thể chỉnh cài đặt rồi bắt đầu ván mới'
        })
        emit_game_state_to_room(game_id)

def announce_topic(game, timed_out=False):
    player = game.get_current_player()
    prefix = '⏰ Hết giờ ra đề, đề ngẫu nhiên' if timed_out else f'{player.name} ra đề'
    emit_to_room(game.game_id, 'notification', {
        'message': f'{prefix}: "{game.topic}". {player.name} đánh trước!'
    })

def ensure_topic_timer(game):
    """Mỗi lần mở bước ra đề thì hẹn giờ đúng một lần"""
    if game.state == GameState.TOPIC and game.timed_topic_id != game.topic_id:
        game.timed_topic_id = game.topic_id
        socketio.start_background_task(topic_timer, game.game_id, game.topic_id,
                                       game.topic_seconds)

def topic_timer(game_id, topic_id, seconds):
    """Hết giờ ra đề thì lấy một đề ngẫu nhiên để ván không bị kẹt"""
    socketio.sleep(seconds)
    with game_lock:
        game = games.get(game_id)
        if game is None or game.expire_topic(topic_id) is None:
            return
        announce_topic(game, timed_out=True)
        emit_game_state_to_room(game_id)

def vote_timer(game_id, voting_id, seconds):
    """Hết giờ bỏ phiếu thì bỏ qua người chưa vote và chốt kết quả"""
    socketio.sleep(seconds)
    with game_lock:
        game = games.get(game_id)
        if game is None:
            return
        skipped = game.expire_votes(voting_id)
        if not skipped:
            return
        names = ', '.join(game.players[pid].name for pid in skipped if pid in game.players)
        emit_to_room(game_id, 'notification', {
            'message': f'⏰ Hết giờ! Không tính phiếu của: {names}'
        })
        finish_voting_if_complete(game)
        emit_game_state_to_room(game_id)

def remove_player_from_game(player_id):
    """Xóa người chơi khỏi game đang ở (nếu có) và cập nhật cho những người còn lại"""
    game_id = player_to_game.pop(player_id, None)
    if game_id is None:
        return
    leave_room(game_id, sid=player_id)

    game = games.get(game_id)
    if game is None:
        return

    player = game.players.get(player_id)
    was_running = game.state in (GameState.TOPIC, GameState.PLAYING, GameState.VOTING)
    game.remove_player(player_id)

    if not game.players:
        if not game.spectators:
            # Phòng trống thì xóa luôn
            del games[game_id]
            return
        # Chỉ còn người đang chờ: cho họ vào phòng chờ để chơi ván mới
        game.reset_to_lobby()

    if player:
        emit_to_room(game_id, 'notification', {
            'message': f'{player.name} đã rời game'
        })

    if was_running and game.state == GameState.GAME_END:
        announce_winner(game)
    else:
        finish_voting_if_complete(game)

    emit_game_state_to_room(game_id)

def emit_game_state_to_room(game_id):
    """Gửi trạng thái game cho tất cả mọi người trong phòng"""
    if game_id in games:
        game = games[game_id]
        ensure_topic_timer(game)
        ensure_play_timer(game)
        ensure_lobby_timer(game)

        # Gửi player-specific state cho mỗi người, kể cả người đang chờ ván sau
        for player_id in list(game.players) + list(game.spectators):
            socketio.emit('game_state',
                         game.get_state_for_player(player_id),
                         room=player_id)

def emit_to_room(game_id, event, data):
    """Gửi event cho tất cả mọi người trong phòng"""
    socketio.emit(event, data, room=game_id)

# ==================== Start Server ====================

if __name__ == '__main__':
    print("🎮 Meme Card Game Server đang chạy...")
    print("Truy cập: http://localhost:5000")
    socketio.run(app, debug=True, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
