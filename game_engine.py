"""
Game engine cho Meme Card Game
"""
import re
import time
from enum import Enum
from card_deck import Deck
from topics import TOPIC_SUGGESTIONS

HAND_SIZE = 5
MIN_PLAYERS = 2
REJECT_DRAW = 2  # Lá bị từ chối: người đánh rút thêm bấy nhiêu lá (phạt)
# Thời gian mặc định, chủ phòng chỉnh được ở phòng chờ
PLAY_SECONDS = 45  # Thời gian chọn ảnh meme để đánh, hết giờ thì mất lượt
VOTE_SECONDS = 30  # Thời gian tối đa cho một lượt bỏ phiếu
TOPIC_SECONDS = 45  # Thời gian người mở vòng gõ chủ đề, hết giờ thì lấy đề ngẫu nhiên
TOPIC_MAX_LENGTH = 100
# Các lựa chọn chủ phòng được chỉnh (giây; số vòng 0 = không giới hạn)
PLAY_SECONDS_CHOICES = (20, 30, 45, 60, 90)
VOTE_SECONDS_CHOICES = (15, 20, 30, 45, 60)
TOPIC_SECONDS_CHOICES = (20, 30, 45, 60, 90)
MAX_ROUNDS_CHOICES = (0, 3, 5, 8, 10, 15)
SETTING_CHOICES = {
    "play_seconds": PLAY_SECONDS_CHOICES,
    "vote_seconds": VOTE_SECONDS_CHOICES,
    "topic_seconds": TOPIC_SECONDS_CHOICES,
    "max_rounds": MAX_ROUNDS_CHOICES,
}

class GameState(Enum):
    WAITING = "waiting"
    TOPIC = "topic"  # Người mở vòng đang ra chủ đề
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
        # Vòng thứ n do người thứ n (xoay vòng) mở: người đó ra đề và đánh trước.
        # current_player_index = số lượt đã đánh trong vòng, tính từ người mở vòng.
        self.round_start = 0
        self.topic = None
        self.topic_id = 0  # Tăng mỗi lần mở bước ra đề, để hẹn giờ cũ không đặt nhầm đề
        self.topic_deadline = None
        self.timed_topic_id = 0  # Server đã hẹn giờ cho bước ra đề nào rồi
        # Cài đặt ván do chủ phòng chỉnh ở phòng chờ, giữ nguyên qua các ván
        self.play_seconds = PLAY_SECONDS
        self.vote_seconds = VOTE_SECONDS
        self.topic_seconds = TOPIC_SECONDS
        self.max_rounds = 0
        # Người vào khi ván đang chạy: ngồi chờ, hết ván thì vào chơi
        self.spectators = {}  # {player_id: name}, thứ tự vào = thứ tự được xếp chỗ
        self.game_number = 0  # Tăng mỗi ván, để hẹn giờ của ván cũ không đụng ván mới
        self.turn_id = 0  # Tăng mỗi lượt đánh, để hẹn giờ cũ không bỏ lượt nhầm người
        self.play_deadline = None
        self.timed_turn_id = 0  # Server đã hẹn giờ cho lượt đánh nào rồi
        self.timed_lobby_id = 0  # Server đã hẹn giờ quay về phòng chờ cho ván nào rồi
        self.end_reason = None  # 'last_card' / 'players_left' / 'rounds'

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

    @property
    def is_running(self):
        return self.state in (GameState.TOPIC, GameState.PLAYING, GameState.VOTING)

    def headcount(self):
        return len(self.players) + len(self.spectators)

    def add_spectator(self, player_id, name):
        """Vào phòng khi ván đang chạy: ngồi chờ tới ván sau"""
        if self.state == GameState.WAITING:
            return False
        if self.headcount() >= self.max_players or player_id in self.players \
                or player_id in self.spectators:
            return False
        self.spectators[player_id] = name
        return True

    def settings(self):
        return {key: getattr(self, key) for key in SETTING_CHOICES}

    def update_settings(self, player_id, **changes):
        """Chủ phòng chỉnh thời gian chọn ảnh / bỏ phiếu / ra đề và số vòng cho ván tiếp theo"""
        if player_id != self.host_id or self.state != GameState.WAITING:
            return False
        changes = {k: v for k, v in changes.items() if v is not None}
        if any(k not in SETTING_CHOICES or v not in SETTING_CHOICES[k]
               for k, v in changes.items()):
            return False
        for key, value in changes.items():
            setattr(self, key, value)
        return True

    def reset_to_lobby(self):
        """Hết ván: cả phòng quay về phòng chờ, người đang chờ được vào chơi"""
        self.state = GameState.WAITING
        for pid, name in list(self.spectators.items()):
            if len(self.players) >= self.max_players:
                break
            self.players[pid] = Player(pid, name)
            del self.spectators[pid]
        for player in self.players.values():
            player.hand = []
        if self.host_id not in self.players:
            self.host_id = next(iter(self.players), None)
        self.current_round = 0
        self.current_player_index = 0
        self.round_start = 0
        self.current_card = None
        self.votes = {}
        self.vote_deadline = None
        self.topic = None
        self.topic_deadline = None
        self.play_deadline = None
        self.last_result = None
        return True

    def remove_player(self, player_id):
        """Xóa người chơi, giữ đúng lượt và không để game bị kẹt"""
        if player_id in self.spectators:
            del self.spectators[player_id]
            return True
        if player_id not in self.players:
            return False

        player_ids = list(self.players.keys())
        removed_index = player_ids.index(player_id)
        # Vị trí trong lượt của vòng này (tính từ người mở vòng)
        removed_turn = (removed_index - self.round_start) % len(player_ids)
        del self.players[player_id]
        if removed_index < self.round_start:
            self.round_start -= 1

        if self.host_id == player_id:
            self.host_id = next(iter(self.players), None)

        if self.players:
            self.round_start %= len(self.players)

        if self.state not in (GameState.TOPIC, GameState.PLAYING, GameState.VOTING):
            return True

        # Còn dưới 2 người thì kết thúc ván, người còn lại thắng
        if len(self.players) < MIN_PLAYERS:
            self.current_card = None
            self.votes = {}
            self._finish(next(iter(self.players), None), 'players_left')
            return True

        if removed_turn < self.current_player_index:
            self.current_player_index -= 1
        elif removed_turn == self.current_player_index:
            # Người đang tới lượt rời đi: người kế tiếp nhận lượt
            if self.state == GameState.VOTING:
                # Hủy lá đang xét vì người đánh đã rời phòng
                self.current_card = None
                self.votes = {}
                self.vote_deadline = None
                self.state = GameState.PLAYING
            if self.current_player_index >= len(self.players):
                # Người cuối vòng rời đi: sang vòng mới
                self._next_round()
            elif self.state == GameState.TOPIC:
                # Người ra đề rời đi: người kế tiếp ra đề, tính lại giờ
                self._open_topic()
            else:
                # Người kế tiếp nhận lượt đánh, tính lại giờ
                self._open_turn()

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

        self.current_round = 1
        self.round_start = 0
        self.current_player_index = 0
        self.current_card = None
        self.votes = {}
        self.winner_id = None
        self.last_result = None
        self.end_reason = None
        self.game_number += 1
        self._open_topic()
        return True

    def _open_topic(self):
        """Mở bước ra đề cho người mở vòng hiện tại"""
        self.state = GameState.TOPIC
        self.topic = None
        self.topic_id += 1
        self.topic_deadline = self.clock() + self.topic_seconds
        self.play_deadline = None

    def _open_turn(self):
        """Mở lượt đánh cho người đang tới lượt, bắt đầu đếm giờ chọn ảnh"""
        self.state = GameState.PLAYING
        self.turn_id += 1
        self.play_deadline = self.clock() + self.play_seconds

    def _advance_turn(self):
        """Sang người kế tiếp; hết vòng thì sang vòng mới (ra đề mới)"""
        self.current_player_index += 1
        if self.current_player_index >= len(self.players):
            self._next_round()
        else:
            self._open_turn()

    def expire_turn(self, turn_id=None):
        """Hết giờ chọn ảnh: người đang tới lượt mất lượt. Trả về người bị bỏ qua, hoặc None"""
        if self.state != GameState.PLAYING:
            return None
        if turn_id is not None and turn_id != self.turn_id:
            return None
        skipped = self.get_current_player()
        self._advance_turn()
        return skipped.player_id if skipped else None

    def play_time_left(self):
        if self.state != GameState.PLAYING or self.play_deadline is None:
            return None
        return max(0, round(self.play_deadline - self.clock()))

    def _next_round(self):
        if self.max_rounds and self.current_round >= self.max_rounds:
            # Đủ số vòng chủ phòng đặt: ai ít bài nhất thắng
            self._finish_by_limit('rounds')
            return
        self.current_round += 1
        self.current_player_index = 0
        if self.players:
            self.round_start = (self.round_start + 1) % len(self.players)
        self._open_topic()

    @staticmethod
    def clean_topic(text):
        """Gộp khoảng trắng, cắt độ dài. Trả về '' nếu không còn gì"""
        text = re.sub(r'\s+', ' ', str(text or '')).strip()
        return text[:TOPIC_MAX_LENGTH].strip()

    def _round_opener_id(self):
        player_ids = list(self.players.keys())
        return player_ids[self.round_start % len(player_ids)] if player_ids else None

    def get_topic_setter(self):
        return self.get_current_player() if self.state == GameState.TOPIC else None

    def set_topic(self, player_id, text):
        """Người mở vòng gõ chủ đề; xong thì người đó đánh lá đầu tiên"""
        setter = self.get_topic_setter()
        if setter is None or setter.player_id != player_id:
            return False
        topic = self.clean_topic(text)
        if not topic:
            return False
        self.topic = topic
        self.topic_deadline = None
        self._open_turn()
        return True

    def expire_topic(self, topic_id=None):
        """Hết giờ ra đề: lấy một đề ngẫu nhiên. Trả về đề đã đặt, hoặc None"""
        if self.state != GameState.TOPIC:
            return None
        if topic_id is not None and topic_id != self.topic_id:
            return None
        setter = self.get_topic_setter()
        self.set_topic(setter.player_id, self.deck.rng.choice(TOPIC_SUGGESTIONS))
        return self.topic

    def topic_time_left(self):
        if self.state != GameState.TOPIC or self.topic_deadline is None:
            return None
        return max(0, round(self.topic_deadline - self.clock()))

    def get_current_player(self):
        """Lấy người chơi hiện tại"""
        player_ids = list(self.players.keys())
        if not player_ids:
            return None
        index = (self.round_start + self.current_player_index) % len(player_ids)
        return self.players[player_ids[index]]

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
        self.play_deadline = None
        self.voting_id += 1
        self.vote_deadline = self.clock() + self.vote_seconds
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
            # Lá bài bị từ chối: mất lượt và bị phạt rút thêm lá
            for card in self.deck.draw_multiple(REJECT_DRAW):
                player.add_card(card)

        # Chuyển sang người chơi tiếp theo, hết một vòng thì sang vòng mới (ra đề mới)
        self._advance_turn()

        return {
            "success": False,
            "vote_result": result,
            "message": "Vòng bỏ phiếu kết thúc, chuyển sang người chơi tiếp theo"
        }

    def leader_id(self):
        """Người dẫn đầu: ít bài nhất, bằng nhau thì nhiều điểm hơn, rồi theo thứ tự ngồi"""
        if not self.players:
            return None
        order = list(self.players)
        return min(order, key=lambda pid: (len(self.players[pid].hand),
                                           -self.players[pid].score, order.index(pid)))

    def _finish_by_limit(self, reason):
        self.current_card = None
        self._finish(self.leader_id(), reason)

    def _finish(self, winner_id, reason='last_card'):
        self.state = GameState.GAME_END
        self.winner_id = winner_id
        self.end_reason = reason
        self.play_deadline = None
        self.votes = {}
        self.vote_deadline = None
        self.topic_deadline = None

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
            "vote_seconds": self.vote_seconds,
            "last_result": self.last_result,
            "topic": self.topic,
            "round_opener_id": self._round_opener_id(),
            "topic_id": self.topic_id,
            "topic_time_left": self.topic_time_left(),
            "topic_seconds": self.topic_seconds,
            "turn_id": self.turn_id,
            "play_time_left": self.play_time_left(),
            "play_seconds": self.play_seconds,
            "topic_max_length": TOPIC_MAX_LENGTH,
            "settings": self.settings(),
            "setting_choices": {k: list(v) for k, v in SETTING_CHOICES.items()},
            "end_reason": self.end_reason,
            "game_number": self.game_number,
            "spectators": [{"player_id": pid, "name": name}
                           for pid, name in self.spectators.items()],
            "max_players": self.max_players,
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
        state["is_spectator"] = player_id in self.spectators
        return state
