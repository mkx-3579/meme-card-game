"""
Game engine cho Meme Card Game
"""
import time
from enum import Enum
from card_deck import Deck

HAND_SIZE = 5
MIN_PLAYERS = 2
VOTE_SECONDS = 30  # Thời gian tối đa cho một lượt bỏ phiếu

class GameState(Enum):
    WAITING = "waiting"
    PLAYING = "playing"
    VOTING = "voting"
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
        if isinstance(card_index, int) and not isinstance(card_index, bool) \
                and 0 <= card_index < len(self.hand):
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
        data = self.to_dict()
        data["hand"] = list(self.hand)
        return data

class Game:
    def __init__(self, game_id, max_players=8, seed=None, clock=time.monotonic):
        self.game_id = game_id
        self.max_players = max_players
        self.players = {}  # Thứ tự thêm vào = thứ tự lượt chơi
        self.deck = Deck(seed)
        self.state = GameState.WAITING
        self.current_round = 0
        self.current_player_index = 0
        self.current_card = None
        self.votes = {}  # {player_id: True/False/None}
        self.host_id = None
        self.winner_id = None
        self.clock = clock  # Truyền đồng hồ giả để test hẹn giờ
        self.voting_id = 0  # Tăng mỗi lần mở bỏ phiếu, để hẹn giờ cũ không chốt nhầm lượt mới
        self.vote_deadline = None
        self.last_result = None  # Kết quả lượt vote gần nhất (ai vote gì) để hiện cho cả phòng

    @property
    def game_started(self):
        return self.state != GameState.WAITING

    def add_player(self, player_id, name):
        """Thêm người chơi mới (chỉ khi game chưa bắt đầu)"""
        if self.state != GameState.WAITING:
            return False
        if len(self.players) >= self.max_players or player_id in self.players:
            return False

        self.players[player_id] = Player(player_id, name)
        if self.host_id is None:
            self.host_id = player_id
        return True

    def remove_player(self, player_id):
        """Xóa người chơi, giữ đúng lượt và không để game bị kẹt"""
        if player_id not in self.players:
            return False

        player_ids = list(self.players.keys())
        removed_index = player_ids.index(player_id)
        del self.players[player_id]

        if self.host_id == player_id:
            self.host_id = next(iter(self.players), None)

        if self.state not in (GameState.PLAYING, GameState.VOTING):
            return True

        # Còn dưới 2 người thì kết thúc ván, người còn lại thắng
        if len(self.players) < MIN_PLAYERS:
            self.current_card = None
            self.votes = {}
            self._finish(next(iter(self.players), None))
            return True

        if removed_index < self.current_player_index:
            self.current_player_index -= 1
        elif removed_index == self.current_player_index:
            # Người đang tới lượt rời đi: người kế tiếp nhận lượt
            if self.state == GameState.VOTING:
                # Hủy lá đang xét vì người đánh đã rời phòng
                self.current_card = None
                self.votes = {}
                self.vote_deadline = None
                self.state = GameState.PLAYING
            self.current_player_index %= len(self.players)

        # Người rời đi không còn phải bỏ phiếu
        self.votes.pop(player_id, None)
        return True

    def start_game(self):
        """Bắt đầu game"""
        if self.state != GameState.WAITING or len(self.players) < MIN_PLAYERS:
            return False

        # Cấp 5 lá bài cho mỗi người chơi
        for player in self.players.values():
            player.hand = self.deck.draw_multiple(HAND_SIZE)
            player.score = 0

        self.state = GameState.PLAYING
        self.current_round = 1
        self.current_player_index = 0
        self.current_card = None
        self.votes = {}
        self.winner_id = None
        self.last_result = None
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
        if current_player is None or current_player.player_id != player_id:
            return False

        card = current_player.play_card(card_index)
        if card is None:
            return False

        self.current_card = {
            "content": card,
            "played_by": player_id,
            # Lá cuối = lá làm tay người chơi đó về 0
            "is_final_card": len(current_player.hand) == 0
        }

        # Người đánh bài không bỏ phiếu cho lá của mình
        self.votes = {
            pid: None
            for pid in self.players.keys()
            if pid != player_id
        }

        self.state = GameState.VOTING
        self.voting_id += 1
        self.vote_deadline = self.clock() + VOTE_SECONDS
        return True

    def player_vote(self, player_id, is_valid):
        """Người chơi bỏ phiếu"""
        if self.state != GameState.VOTING:
            return False

        if player_id not in self.votes or self.votes[player_id] is not None:
            return False

        self.votes[player_id] = bool(is_valid)
        return True

    def expire_votes(self, voting_id=None):
        """Hết giờ: ai chưa bỏ phiếu thì không được tính. Trả về danh sách người bị bỏ qua.

        voting_id: chỉ hết giờ nếu vẫn đúng lượt vote đó (hẹn giờ cũ thì bỏ qua)."""
        if self.state != GameState.VOTING:
            return []
        if voting_id is not None and voting_id != self.voting_id:
            return []
        skipped = [pid for pid, v in self.votes.items() if v is None]
        for pid in skipped:
            del self.votes[pid]
        return skipped

    def vote_time_left(self):
        if self.state != GameState.VOTING or self.vote_deadline is None:
            return None
        return max(0, round(self.vote_deadline - self.clock()))

    def check_voting_complete(self):
        """Kiểm tra xem tất cả mọi người đã bỏ phiếu chưa"""
        return self.state == GameState.VOTING and None not in self.votes.values()

    def calculate_vote_result(self):
        """Tính toán kết quả bỏ phiếu"""
        valid_votes = sum(1 for v in self.votes.values() if v)
        total_votes = len(self.votes)
        is_final_card = self.current_card["is_final_card"]

        if is_final_card:
            # Lá cuối: cần 1/2 (50%) người đồng ý
            required_votes = total_votes / 2
        else:
            # Bài bình thường: cần 3/4 (75%) người đồng ý
            required_votes = (total_votes * 3) / 4

        return {
            # Không ai bỏ phiếu (hết giờ) thì lá bị từ chối
            "is_valid": total_votes > 0 and valid_votes >= required_votes,
            "valid_votes": valid_votes,
            "total_votes": total_votes,
            "required_votes": required_votes,
            "is_final_card": is_final_card
        }

    def end_voting(self):
        """Kết thúc vòng bỏ phiếu. Trả về None nếu chưa thể kết thúc."""
        if not self.check_voting_complete():
            return None

        result = self.calculate_vote_result()
        played_by = self.current_card["played_by"]
        player = self.players[played_by]
        self.last_result = {
            "voting_id": self.voting_id,
            "played_by": played_by,
            "is_valid": result["is_valid"],
            "valid_votes": result["valid_votes"],
            "total_votes": result["total_votes"],
            "votes": dict(self.votes),
        }
        self.vote_deadline = None

        if result["is_valid"]:
            player.score += 1
            if result["is_final_card"]:
                # Lá cuối được chấp nhận: người chơi đó thắng
                self._finish(played_by)
                return {
                    "success": True,
                    "winner": played_by,
                    "vote_result": result,
                    "message": f"{player.name} đã thắng với lá bài cuối!"
                }
        else:
            # Lá bài bị từ chối: mất lượt và rút 1 lá bài mới
            player.add_card(self.deck.draw_card())

        # Chuyển sang người chơi tiếp theo, hết một vòng thì sang round mới
        self.current_player_index += 1
        if self.current_player_index >= len(self.players):
            self.current_player_index = 0
            self.current_round += 1
        self.state = GameState.PLAYING

        return {
            "success": False,
            "vote_result": result,
            "message": "Vòng bỏ phiếu kết thúc, chuyển sang người chơi tiếp theo"
        }

    def _finish(self, winner_id):
        self.state = GameState.GAME_END
        self.winner_id = winner_id
        self.votes = {}
        self.vote_deadline = None

    def get_state(self):
        """Lấy trạng thái game hiện tại (không kèm phiếu của từng người)"""
        current_player = self.get_current_player()
        voting = self.state == GameState.VOTING
        return {
            "game_id": self.game_id,
            "state": self.state.value,
            "round": self.current_round,
            "host_id": self.host_id,
            "winner_id": self.winner_id,
            "players": [p.to_dict() for p in self.players.values()],
            "current_player_id": current_player.player_id if current_player else None,
            "current_card": self.current_card,
            "votes_count": sum(1 for v in self.votes.values() if v is not None) if voting else 0,
            "total_voters": len(self.votes) if voting else 0,
            # Ai đã/chưa bỏ phiếu (không lộ họ chọn gì cho tới khi chốt)
            "voters": [
                {"player_id": pid, "voted": v is not None}
                for pid, v in self.votes.items()
            ] if voting else [],
            "voting_id": self.voting_id,
            "vote_time_left": self.vote_time_left(),
            "vote_seconds": VOTE_SECONDS,
            "last_result": self.last_result,
        }

    def get_state_for_player(self, player_id):
        """Lấy trạng thái game kèm tay bài và phiếu của riêng player đó"""
        state = self.get_state()

        state["players"] = [
            self.players[p["player_id"]].to_dict_with_hand()
            if p["player_id"] == player_id else p
            for p in state["players"]
        ]
        voting = self.state == GameState.VOTING
        state["can_vote"] = voting and player_id in self.votes
        state["my_vote"] = self.votes.get(player_id) if voting else None
        return state
