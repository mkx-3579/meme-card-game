"""
Meme Card Game - Flask Backend với SocketIO
"""
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room, rooms
from game_engine import Game
import uuid
import json

app = Flask(__name__)
app.config['SECRET_KEY'] = 'meme-card-game-secret'
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

@app.route('/')
def index():
    return render_template('index.html')

# ==================== SocketIO Events ====================

@socketio.on('connect')
def handle_connect():
    print(f'Player connected: {request.sid}')

@socketio.on('disconnect')
def handle_disconnect():
    player_id = request.sid
    if player_id in player_to_game:
        game_id = player_to_game[player_id]
        if game_id in games:
            games[game_id].remove_player(player_id)
            # Thông báo cho những người còn lại
            emit_game_state_to_room(game_id)
        del player_to_game[player_id]
    print(f'Player disconnected: {player_id}')

@socketio.on('create_game')
def handle_create_game(data):
    """Tạo một game mới"""
    player_id = request.sid
    player_name = data.get('name', f'Player {player_id[:8]}')
    
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
    game_id = data.get('game_id')
    player_name = data.get('name', f'Player {player_id[:8]}')
    
    if game_id not in games:
        emit('error', {'message': f'Game {game_id} không tồn tại'})
        return
    
    game = games[game_id]
    
    if not game.add_player(player_id, player_name):
        emit('error', {'message': 'Game đã đầy'})
        return
    
    player_to_game[player_id] = game_id
    join_room(game_id)
    
    emit('game_joined', {
        'game_id': game_id,
        'player_id': player_id,
        'message': f'{player_name} đã tham gia game'
    })
    
    emit_game_state_to_room(game_id)

@socketio.on('start_game')
def handle_start_game():
    """Bắt đầu game"""
    player_id = request.sid
    if player_id not in player_to_game:
        emit('error', {'message': 'Bạn không ở trong game nào'})
        return
    
    game_id = player_to_game[player_id]
    game = games[game_id]
    
    if game.start_game():
        emit_game_state_to_room(game_id)
        emit_to_room(game_id, 'notification', {
            'message': 'Game bắt đầu! Người chơi đầu tiên, hãy chọn 1 lá bài để đánh'
        })
    else:
        emit('error', {'message': 'Không thể bắt đầu game. Cần ít nhất 2 người chơi'})

@socketio.on('play_card')
def handle_play_card(data):
    """Người chơi đánh bài"""
    player_id = request.sid
    if player_id not in player_to_game:
        emit('error', {'message': 'Bạn không ở trong game nào'})
        return
    
    game_id = player_to_game[player_id]
    game = games[game_id]
    card_index = data.get('card_index')
    
    if game.player_play_card(player_id, card_index):
        player = game.players[player_id]
        emit_to_room(game_id, 'notification', {
            'message': f'{player.name} đã đánh 1 lá bài. Bây giờ mọi người bình chọn!'
        })
        emit_game_state_to_room(game_id)
    else:
        emit('error', {'message': 'Không thể đánh bài. Đảm bảo đó là lượt của bạn'})

@socketio.on('vote')
def handle_vote(data):
    """Bỏ phiếu cho lá bài"""
    player_id = request.sid
    if player_id not in player_to_game:
        emit('error', {'message': 'Bạn không ở trong game nào'})
        return
    
    game_id = player_to_game[player_id]
    game = games[game_id]
    is_valid = data.get('is_valid', False)
    
    if game.player_vote(player_id, is_valid):
        player = game.players[player_id]
        vote_text = '✅ Hợp lệ' if is_valid else '❌ Không hợp lệ'
        emit_to_room(game_id, 'notification', {
            'message': f'{player.name} bỏ phiếu: {vote_text}'
        })
        
        # Kiểm tra xem tất cả mọi người đã bỏ phiếu chưa
        if game.check_voting_complete():
            # Kết thúc vòng bỏ phiếu
            result = game.end_voting()
            
            if result.get('success'):
                # Game kết thúc
                emit_to_room(game_id, 'notification', {
                    'message': f"🎉 {result['message']}",
                    'type': 'winner'
                })
            else:
                # Hiển thị kết quả bỏ phiếu
                vote_result = game.calculate_vote_result()
                validity_text = 'ĐƯỢC CHẤP NHẬN' if vote_result['is_valid'] else 'BỊ TỪ CHỐI'
                emit_to_room(game_id, 'notification', {
                    'message': f"Kết quả bỏ phiếu: {validity_text} ({vote_result['valid_votes']}/{vote_result['total_votes']})"
                })
        
        emit_game_state_to_room(game_id)
    else:
        emit('error', {'message': 'Lỗi khi bỏ phiếu'})

@socketio.on('get_game_state')
def handle_get_game_state():
    """Lấy trạng thái game"""
    player_id = request.sid
    if player_id not in player_to_game:
        emit('error', {'message': 'Bạn không ở trong game nào'})
        return
    
    game_id = player_to_game[player_id]
    game = games[game_id]
    
    # Gửi game state với hand info cho player này
    emit('game_state', game.get_state_for_player(player_id))

# ==================== Utility Functions ====================

def emit_game_state_to_room(game_id):
    """Gửi trạng thái game cho tất cả mọi người trong phòng"""
    if game_id in games:
        game = games[game_id]
        
        # Gửi player-specific state cho mỗi player
        for player_id in game.players.keys():
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
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
