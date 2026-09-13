"""
Game engine cho Meme Card Game
"""
from enum import Enum
from card_deck import Deck

class GameState(Enum):
    WAITING = "waiting"
    PLAYING = "playing"
    VOTING = "voting"
    ROUND_END = "round_end"
    GAME_END = "game_end"

class Player:
    def __init__(self, player_id, name):
        self.player_id = player_id
        self.name = name
        self.hand = []
        self.score = 0
        self.is_active = True
    
    def add_card(self, card):
        self.hand.append(card)
    
    def play_card(self, card_index):
        if 0 <= card_index < len(self.hand):
            return self.hand.pop(card_index)
        return None
    
    def to_dict(self):
        return {
            "player_id": self.player_id,
            "name": self.name,
            "hand_count": len(self.hand),
            "score": self.score,
            "is_active": self.is_active
        }
    
    def to_dict_with_hand(self):
        """Lấy thông tin player kèm chi tiết tay bài (chỉ cho chính player đó)"""
        return {
            "player_id": self.player_id,
            "name": self.name,
            "hand": self.hand,
            "hand_count": len(self.hand),
            "score": self.score,
            "is_active": self.is_active
        }

class Game:
    def __init__(self, game_id, max_players=8):
        self.game_id = game_id
        self.max_players = max_players
        self.players = {}
        self.deck = Deck()
        self.state = GameState.WAITING
        self.current_round = 0
        self.current_player_index = 0
        self.current_card = None
        self.votes = {}  # {player_id: True/False}
        self.card_play_order = []  # Theo dõi thứ tự người chơi đã chơi bài
        
        # Cho phép vào game
        self.game_started = False
    
    def add_player(self, player_id, name):
        """Thêm người chơi mới"""
        if len(self.players) >= self.max_players:
            return False
        
        player = Player(player_id, name)
        self.players[player_id] = player
        return True
    
    def remove_player(self, player_id):
        """Xóa người chơi"""
        if player_id in self.players:
            del self.players[player_id]
            return True
        return False
    
    def start_game(self):
        """Bắt đầu game"""
        if len(self.players) < 2:
            return False
        
        # Cấp 5 lá bài cho mỗi người chơi
        for player in self.players.values():
            cards = self.deck.draw_multiple(5)
            player.hand = cards
        
        self.state = GameState.PLAYING
        self.game_started = True
        self.current_round = 1
        self.current_player_index = 0
        return True
    
    def get_current_player(self):
        """Lấy người chơi hiện tại"""
        player_ids = list(self.players.keys())
        if not player_ids:
            return None
        return self.players[player_ids[self.current_player_index % len(player_ids)]]
    
    def player_play_card(self, player_id, card_index):
        """Người chơi đánh bài"""
        if self.state != GameState.PLAYING:
            return False
        
        current_player = self.get_current_player()
        if current_player.player_id != player_id:
            return False
        
        card = current_player.play_card(card_index)
        if card is None:
            return False
        
        self.current_card = {
            "content": card,
            "played_by": player_id,
            "card_index": len(self.card_play_order)  # Số lá bài đã đánh trong round
        }
        
        self.card_play_order.append(player_id)
        
        # Xóa người chơi hiện tại khỏi danh sách bỏ phiếu (người đánh bài không bỏ phiếu cho lá của mình)
        self.votes = {
            pid: None 
            for pid in self.players.keys() 
            if pid != player_id
        }
        
        self.state = GameState.VOTING
        return True
    
    def player_vote(self, player_id, is_valid):
        """Người chơi bỏ phiếu"""
        if self.state != GameState.VOTING:
            return False
        
        if player_id not in self.votes or self.votes[player_id] is not None:
            return False
        
        self.votes[player_id] = is_valid
        return True
    
    def check_voting_complete(self):
        """Kiểm tra xem tất cả mọi người đã bỏ phiếu chưa"""
        if None in self.votes.values():
            return False
        return True
    
    def calculate_vote_result(self):
        """Tính toán kết quả bỏ phiếu"""
        valid_votes = sum(1 for v in self.votes.values() if v)
        total_votes = len(self.votes)
        
        # Kiểm tra xem đây có phải lá bài cuối cùng không
        # Lá bài cuối cùng là lá thứ 5 (card_index = 4)
        is_final_card = self.current_card["card_index"] >= 4
        
        if is_final_card:
            # Lá cuối: cần 1/2 (50%) người đồng ý
            required_votes = total_votes / 2
            is_valid = valid_votes >= required_votes
        else:
            # Bài bình thường: cần 3/4 (75%) người đồng ý
            required_votes = (total_votes * 3) / 4
            is_valid = valid_votes >= required_votes
        
        return {
            "is_valid": is_valid,
            "valid_votes": valid_votes,
            "total_votes": total_votes,
            "required_votes": required_votes,
            "is_final_card": is_final_card
        }
    
    def end_voting(self):
        """Kết thúc vòng bỏ phiếu"""
        result = self.calculate_vote_result()
        
        played_by = self.current_card["played_by"]
        player = self.players[played_by]
        
        if result["is_valid"]:
            # Lá bài được chấp nhận
            if result["is_final_card"]:
                # Nếu là lá bài cuối, người chơi đó thắng
                player.score += 10  # Điểm thắng
                return {
                    "success": True,
                    "winner": played_by,
                    "message": f"{player.name} đã thắng với lá bài cuối!"
                }
            else:
                # Bài bình thường được chấp nhận, được +1 điểm
                player.score += 1
        else:
            # Lá bài bị từ chối, người chơi rút 1 lá bài mới
            new_card = self.deck.draw_card()
            player.add_card(new_card)
        
        # Chuyển sang người chơi tiếp theo
        self.current_player_index += 1
        self.state = GameState.PLAYING
        
        # Kiểm tra nếu người chơi còn lá bài
        if len(player.hand) == 0 and result["is_final_card"]:
            return {
                "success": True,
                "winner": played_by,
                "message": f"{player.name} đã thắng!"
            }
        
        # Kiểm tra nếu hết người chơi (ai đó đã hết lá bài trước)
        remaining_players = [p for p in self.players.values() if len(p.hand) > 0]
        if len(remaining_players) <= 1:
            winner = remaining_players[0] if remaining_players else None
            return {
                "success": True,
                "winner": winner.player_id if winner else None,
                "message": f"{winner.name if winner else 'Không ai'} đã thắng!"
            }
        
        return {
            "success": False,
            "message": "Vòng bỏ phiếu kết thúc, chuyển sang người chơi tiếp theo"
        }
    
    def get_state(self):
        """Lấy trạng thái game hiện tại"""
        return {
            "game_id": self.game_id,
            "state": self.state.value,
            "round": self.current_round,
            "players": [p.to_dict() for p in self.players.values()],
            "current_player_id": self.get_current_player().player_id if self.get_current_player() else None,
            "current_card": self.current_card,
            "votes": self.votes if self.state == GameState.VOTING else {},
            "votes_count": sum(1 for v in self.votes.values() if v is not None) if self.votes else 0,
            "total_voters": len(self.votes) if self.votes else 0
        }
    
    def get_state_for_player(self, player_id):
        """Lấy trạng thái game nhưng kèm thông tin tay bài cho player cụ thể"""
        state = self.get_state()
        
        # Thay thế player info của player này bằng info có kèm hand
        players = state["players"]
        for i, p in enumerate(players):
            if p["player_id"] == player_id:
                player = self.players[player_id]
                players[i] = player.to_dict_with_hand()
        
        state["players"] = players
        return state
