"""
Unit test cho logic Meme Card Game (chỉ dùng unittest có sẵn của Python)

Chạy: python -m unittest discover -s tests
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from game_engine import (  # noqa: E402
    Game, GameState, HAND_SIZE, REJECT_DRAW, VOTE_SECONDS, TOPIC_SECONDS, TOPIC_MAX_LENGTH)
from topics import TOPIC_SUGGESTIONS  # noqa: E402

SEED = 42


def make_game(names='ABC', start=True):
    game = Game('test', seed=SEED)
    for name in names:
        game.add_player(name, name)
    if start:
        game.start_game()
        set_topic(game)
    return game


def set_topic(game, text='Đề thử'):
    """Người mở vòng ra đề để vòng bắt đầu đánh bài"""
    assert game.set_topic(game.get_current_player().player_id, text)


def vote_all(game, is_valid):
    for pid in list(game.votes):
        game.player_vote(pid, is_valid)


def play_turn(game, is_valid=True):
    """Người đang tới lượt đánh lá đầu tiên, mọi người vote giống nhau"""
    if game.state == GameState.TOPIC:
        set_topic(game)
    pid = game.get_current_player().player_id
    assert game.player_play_card(pid, 0)
    vote_all(game, is_valid)
    return pid, game.end_voting()


def snapshot(game):
    return (game.state, game.current_player_index, game.current_card,
            dict(game.votes), {p: list(pl.hand) for p, pl in game.players.items()})


class TestSetup(unittest.TestCase):
    def test_new_game_waits_and_first_player_is_host(self):
        game = make_game(start=False)
        self.assertEqual(game.state, GameState.WAITING)
        self.assertEqual(game.host_id, 'A')
        self.assertIsNone(game.winner_id)

    def test_start_deals_five_cards_and_first_player_starts(self):
        game = make_game(start=False)
        game.start_game()
        # Vòng đầu bắt đầu bằng bước ra đề của người chơi đầu tiên
        self.assertEqual(game.state, GameState.TOPIC)
        self.assertEqual(game.get_current_player().player_id, 'A')
        for player in game.players.values():
            self.assertEqual(len(player.hand), HAND_SIZE)

    def test_cannot_start_with_one_player(self):
        game = make_game('A', start=False)
        self.assertFalse(game.start_game())
        self.assertEqual(game.state, GameState.WAITING)

    def test_cannot_join_after_start(self):
        game = make_game()
        self.assertFalse(game.add_player('D', 'D'))
        self.assertNotIn('D', game.players)

    def test_cannot_join_full_game(self):
        game = Game('full', max_players=2, seed=SEED)
        self.assertTrue(game.add_player('A', 'A'))
        self.assertTrue(game.add_player('B', 'B'))
        self.assertFalse(game.add_player('C', 'C'))

    def test_same_seed_deals_same_hands(self):
        a, b = make_game(), make_game()
        self.assertEqual([p.hand for p in a.players.values()],
                         [p.hand for p in b.players.values()])


class TestPlaying(unittest.TestCase):
    def test_valid_play_moves_to_voting_and_excludes_player_from_votes(self):
        game = make_game()
        self.assertTrue(game.player_play_card('A', 0))
        self.assertEqual(game.state, GameState.VOTING)
        self.assertEqual(set(game.votes), {'B', 'C'})
        self.assertEqual(len(game.players['A'].hand), HAND_SIZE - 1)

    def test_out_of_range_card_is_rejected_without_change(self):
        game = make_game()
        for bad in (-1, HAND_SIZE, None, '0', True):
            before = snapshot(game)
            self.assertFalse(game.player_play_card('A', bad))
            self.assertEqual(snapshot(game), before)

    def test_playing_out_of_turn_is_rejected_without_change(self):
        game = make_game()
        before = snapshot(game)
        self.assertFalse(game.player_play_card('B', 0))
        self.assertEqual(snapshot(game), before)

    def test_card_owner_and_double_votes_are_rejected(self):
        game = make_game()
        game.player_play_card('A', 0)
        self.assertFalse(game.player_vote('A', True))
        self.assertTrue(game.player_vote('B', True))
        self.assertFalse(game.player_vote('B', False))
        self.assertTrue(game.votes['B'])

    def test_end_voting_before_everyone_voted_does_nothing(self):
        game = make_game()
        game.player_play_card('A', 0)
        game.player_vote('B', True)
        self.assertIsNone(game.end_voting())
        self.assertEqual(game.state, GameState.VOTING)

    def test_accepted_card_scores_and_passes_turn(self):
        game = make_game()
        pid, result = play_turn(game, True)
        self.assertFalse(result['success'])
        self.assertTrue(result['vote_result']['is_valid'])
        self.assertEqual(game.players[pid].score, 1)
        self.assertEqual(len(game.players[pid].hand), HAND_SIZE - 1)
        self.assertEqual(game.get_current_player().player_id, 'B')

    def test_rejected_card_draws_penalty_and_passes_turn(self):
        game = make_game()
        pid, result = play_turn(game, False)
        self.assertFalse(result['vote_result']['is_valid'])
        self.assertEqual(game.players[pid].score, 0)
        # Đánh 1 lá, bị phạt rút 2: tay nhiều hơn 1 lá so với lúc đầu
        self.assertEqual(REJECT_DRAW, 2)
        self.assertEqual(len(game.players[pid].hand), HAND_SIZE - 1 + REJECT_DRAW)
        self.assertEqual(game.get_current_player().player_id, 'B')

    def test_normal_card_needs_three_quarters(self):
        game = make_game('ABCDE')  # 4 người bỏ phiếu
        game.player_play_card('A', 0)
        for pid, ok in zip('BCDE', (True, True, False, False)):
            game.player_vote(pid, ok)
        self.assertFalse(game.end_voting()['vote_result']['is_valid'])

    def test_round_increases_after_everyone_played(self):
        game = make_game()
        for _ in range(3):
            play_turn(game, True)
        self.assertEqual(game.current_round, 2)
        # Vòng 2 do người thứ 2 mở: ra đề rồi đánh trước
        self.assertEqual(game.state, GameState.TOPIC)
        self.assertEqual(game.get_current_player().player_id, 'B')
        set_topic(game)
        order = [play_turn(game, True)[0] for _ in range(3)]
        self.assertEqual(order, ['B', 'C', 'A'])
        self.assertEqual(game.current_round, 3)
        self.assertEqual(game.get_current_player().player_id, 'C')


class TestWinning(unittest.TestCase):
    def give_last_card(self, game, pid):
        game.players[pid].hand = game.players[pid].hand[:1]

    def test_fifth_card_on_table_does_not_win(self):
        # Lỗi cũ: lá thứ 5 của cả bàn (ai đánh cũng được) thắng ngay
        game = make_game()
        for _ in range(5):
            pid, result = play_turn(game, True)
            self.assertFalse(result['success'])
        self.assertEqual(game.state, GameState.PLAYING)

    def test_last_card_with_half_votes_wins_for_first_player(self):
        game = make_game('ABC')
        self.give_last_card(game, 'A')
        game.player_play_card('A', 0)
        self.assertTrue(game.current_card['is_final_card'])
        game.player_vote('B', True)
        game.player_vote('C', False)
        result = game.end_voting()
        self.assertTrue(result['success'])
        self.assertEqual(result['winner'], 'A')
        self.assertEqual(game.state, GameState.GAME_END)
        self.assertEqual(game.winner_id, 'A')

    def test_last_card_wins_for_other_player(self):
        game = make_game('ABC')
        play_turn(game, True)
        self.give_last_card(game, 'B')
        pid, result = play_turn(game, True)
        self.assertEqual(pid, 'B')
        self.assertEqual(result['winner'], 'B')

    def test_rejected_last_card_does_not_win(self):
        game = make_game('ABC')
        self.give_last_card(game, 'A')
        pid, result = play_turn(game, False)
        self.assertFalse(result['success'])
        self.assertEqual(len(game.players['A'].hand), REJECT_DRAW)
        self.assertEqual(game.state, GameState.PLAYING)

    def test_no_moves_after_game_end(self):
        game = make_game('ABC')
        self.give_last_card(game, 'A')
        play_turn(game, True)
        before = snapshot(game)
        self.assertFalse(game.player_play_card('B', 0))
        self.assertFalse(game.player_vote('B', True))
        self.assertIsNone(game.end_voting())
        self.assertFalse(game.add_player('D', 'D'))
        self.assertFalse(game.start_game())
        self.assertEqual(snapshot(game), before)


class TestLeaving(unittest.TestCase):
    def test_voter_leaving_completes_voting(self):
        game = make_game('ABC')
        game.player_play_card('A', 0)
        game.player_vote('B', True)
        game.remove_player('C')
        self.assertTrue(game.check_voting_complete())
        self.assertIsNotNone(game.end_voting())

    def test_card_owner_leaving_cancels_card_without_crash(self):
        game = make_game('ABCD')
        game.player_play_card('A', 0)
        game.remove_player('A')
        self.assertEqual(game.state, GameState.PLAYING)
        self.assertIsNone(game.current_card)
        self.assertEqual(game.get_current_player().player_id, 'B')

    def test_player_before_current_leaving_keeps_turn(self):
        game = make_game('ABCD')
        play_turn(game, True)  # tới lượt B
        game.remove_player('A')
        self.assertEqual(game.get_current_player().player_id, 'B')

    def test_last_player_in_order_leaving_on_own_turn_wraps(self):
        game = make_game('ABC')
        play_turn(game, True)
        play_turn(game, True)  # tới lượt C
        game.remove_player('C')
        # Người cuối vòng rời đi: sang vòng 2, người thứ 2 (B) ra đề
        self.assertEqual(game.current_round, 2)
        self.assertEqual(game.state, GameState.TOPIC)
        self.assertEqual(game.get_current_player().player_id, 'B')

    def test_one_player_left_wins(self):
        game = make_game('AB')
        game.player_play_card('A', 0)
        game.remove_player('A')
        self.assertEqual(game.state, GameState.GAME_END)
        self.assertEqual(game.winner_id, 'B')

    def test_host_leaving_passes_host(self):
        game = make_game('ABC', start=False)
        game.remove_player('A')
        self.assertEqual(game.host_id, 'B')


class TestStateForPlayer(unittest.TestCase):
    def test_only_own_hand_and_own_vote_are_sent(self):
        game = make_game('ABC')
        game.player_play_card('A', 0)
        game.player_vote('B', False)
        state_c = game.get_state_for_player('C')
        self.assertNotIn('votes', state_c)
        self.assertTrue(state_c['can_vote'])
        self.assertIsNone(state_c['my_vote'])
        self.assertEqual(state_c['votes_count'], 1)
        hands = {p['player_id']: 'hand' in p for p in state_c['players']}
        self.assertEqual(hands, {'A': False, 'B': False, 'C': True})
        state_a = game.get_state_for_player('A')
        self.assertFalse(state_a['can_vote'])
        self.assertFalse(game.get_state_for_player('B')['my_vote'])


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class TestVoteTimer(unittest.TestCase):
    def make(self):
        clock = FakeClock()
        game = Game('t', seed=SEED, clock=clock)
        for name in 'ABC':
            game.add_player(name, name)
        game.start_game()
        set_topic(game)
        return game, clock

    def test_time_left_counts_down(self):
        game, clock = self.make()
        self.assertIsNone(game.vote_time_left())
        game.player_play_card('A', 0)
        self.assertEqual(game.vote_time_left(), VOTE_SECONDS)
        clock.now += 10
        self.assertEqual(game.get_state()['vote_time_left'], VOTE_SECONDS - 10)

    def test_expire_skips_only_missing_voters(self):
        game, _ = self.make()
        game.player_play_card('A', 0)
        game.player_vote('B', True)
        self.assertEqual(game.expire_votes(game.voting_id), ['C'])
        result = game.end_voting()
        # Chỉ còn phiếu của B (1/1) nên lá được chấp nhận
        self.assertTrue(result['vote_result']['is_valid'])
        self.assertEqual(result['vote_result']['total_votes'], 1)

    def test_nobody_votes_means_rejected(self):
        game, _ = self.make()
        game.player_play_card('A', 0)
        game.expire_votes(game.voting_id)
        hand_before = len(game.players['A'].hand)
        result = game.end_voting()
        self.assertFalse(result['vote_result']['is_valid'])
        self.assertEqual(len(game.players['A'].hand), hand_before + REJECT_DRAW)
        self.assertEqual(game.get_current_player().player_id, 'B')

    def test_old_timer_does_not_touch_new_vote(self):
        game, _ = self.make()
        game.player_play_card('A', 0)
        old_id = game.voting_id
        vote_all(game, True)
        game.end_voting()
        game.player_play_card('B', 0)
        self.assertEqual(game.expire_votes(old_id), [])
        self.assertEqual(len(game.votes), 2)

    def test_voters_list_hides_choices_until_result(self):
        game, _ = self.make()
        game.player_play_card('A', 0)
        game.player_vote('B', False)
        state = game.get_state()
        self.assertEqual(state['voters'], [
            {'player_id': 'B', 'voted': True},
            {'player_id': 'C', 'voted': False},
        ])
        game.player_vote('C', True)
        game.end_voting()
        last = game.get_state()['last_result']
        self.assertEqual(last['votes'], {'B': False, 'C': True})
        self.assertEqual(last['played_by'], 'A')
        self.assertEqual(game.get_state()['voters'], [])


if __name__ == '__main__':
    unittest.main()


class TestTopic(unittest.TestCase):
    def make(self):
        clock = FakeClock()
        game = Game('t', seed=SEED, clock=clock)
        for name in 'ABC':
            game.add_player(name, name)
        game.start_game()
        return game, clock

    def test_cannot_play_before_topic(self):
        game, _ = self.make()
        self.assertFalse(game.player_play_card('A', 0))
        self.assertEqual(game.state, GameState.TOPIC)

    def test_only_round_opener_sets_topic(self):
        game, _ = self.make()
        self.assertFalse(game.set_topic('B', 'Không phải lượt B'))
        self.assertTrue(game.set_topic('A', 'Khi sếp nhắn lúc 11h đêm'))
        self.assertEqual(game.state, GameState.PLAYING)
        self.assertEqual(game.get_state()['topic'], 'Khi sếp nhắn lúc 11h đêm')
        self.assertFalse(game.set_topic('A', 'Đề lần hai'))

    def test_topic_is_cleaned_and_limited(self):
        game, _ = self.make()
        self.assertFalse(game.set_topic('A', '   \n  '))
        self.assertFalse(game.set_topic('A', None))
        self.assertTrue(game.set_topic('A', '  Khi   wifi\n mất  ' + 'x' * 200))
        self.assertTrue(game.topic.startswith('Khi wifi mất xx'))
        self.assertEqual(len(game.topic), TOPIC_MAX_LENGTH)

    def test_topic_timeout_picks_suggestion(self):
        game, clock = self.make()
        self.assertEqual(game.topic_time_left(), TOPIC_SECONDS)
        clock.now += TOPIC_SECONDS
        self.assertEqual(game.topic_time_left(), 0)
        topic = game.expire_topic(game.topic_id)
        self.assertIn(topic, TOPIC_SUGGESTIONS)
        self.assertEqual(game.state, GameState.PLAYING)
        self.assertIsNone(game.topic_time_left())

    def test_old_topic_timer_is_ignored(self):
        game, _ = self.make()
        old_id = game.topic_id
        game.set_topic('A', 'Đề vòng 1')
        for _ in range(3):
            play_turn(game, True)
        self.assertEqual(game.state, GameState.TOPIC)
        self.assertIsNone(game.expire_topic(old_id))
        self.assertEqual(game.state, GameState.TOPIC)
        self.assertIsNone(game.topic)

    def test_topic_setter_leaving_passes_topic_to_next(self):
        game, _ = self.make()
        game.remove_player('A')
        self.assertEqual(game.state, GameState.TOPIC)
        self.assertEqual(game.get_current_player().player_id, 'B')
        self.assertTrue(game.set_topic('B', 'Đề của B'))

    def test_opener_leaving_mid_round_keeps_turn(self):
        game = make_game('ABCD')
        for _ in range(4):
            play_turn(game, True)
        set_topic(game)  # Vòng 2: B mở
        play_turn(game, True)  # B đánh, tới lượt C
        game.remove_player('B')
        self.assertEqual(game.get_current_player().player_id, 'C')
        order = [play_turn(game, True)[0] for _ in range(2)]
        self.assertEqual(order, ['C', 'D'])
        # A là người cuối của vòng 2
        self.assertEqual(game.get_current_player().player_id, 'A')
