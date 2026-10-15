"""
Kiểm tra dữ liệu lá bài và danh sách ảnh/âm thanh

Chạy: python -m unittest discover -s tests
"""
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from card_deck import (MEME_CARDS, MEME_TEMPLATES, IMAGE_DIR, SOUND_DIR,  # noqa: E402
                       IMAGE_EXTS, SOUND_EXTS, Deck, build_cards)


def media_files(directory, exts):
    return [name for name in os.listdir(directory) if name.lower().endswith(exts)]


class TestCards(unittest.TestCase):
    def test_every_card_uses_known_template(self):
        for template, caption in MEME_CARDS:
            self.assertIn(template, MEME_TEMPLATES, caption)
            self.assertTrue(caption.strip())

    def test_every_template_has_name_and_emoji(self):
        for key, info in MEME_TEMPLATES.items():
            self.assertTrue(info['name'] and info['emoji'], key)

    def test_card_ids_unique(self):
        ids = [card['id'] for card in build_cards()]
        self.assertEqual(len(ids), len(set(ids)))

    def test_drawn_card_is_a_copy(self):
        deck = Deck(seed=1)
        card = deck.draw_card()
        card['caption'] = 'changed'
        self.assertNotIn('changed', [c['caption'] for c in deck.all_cards])

    def test_same_seed_same_order(self):
        a = [c['id'] for c in Deck(seed=7).draw_multiple(10)]
        b = [c['id'] for c in Deck(seed=7).draw_multiple(10)]
        self.assertEqual(a, b)


class TestAssetsListed(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(ROOT, 'ASSETS.md'), encoding='utf-8') as f:
            self.assets_md = f.read()

    def test_every_image_is_listed_in_assets_md(self):
        for name in media_files(IMAGE_DIR, IMAGE_EXTS):
            self.assertIn(name, self.assets_md, f'{name} chưa có dòng trong ASSETS.md')

    def test_every_sound_is_listed_in_assets_md(self):
        for name in media_files(SOUND_DIR, SOUND_EXTS):
            self.assertIn(name, self.assets_md, f'{name} chưa có dòng trong ASSETS.md')

    def test_images_are_named_after_a_template(self):
        for name in media_files(IMAGE_DIR, IMAGE_EXTS):
            self.assertIn(os.path.splitext(name)[0], MEME_TEMPLATES, name)


if __name__ == '__main__':
    unittest.main()
