"""
Bộ bài meme cho game

Mỗi lá bài = một mẫu meme (ảnh + âm thanh) + một câu chú thích.
Ảnh đặt ở static/memes/img/<mẫu>.<jpg|png|webp|gif>,
âm thanh ở static/sounds/meme-<mẫu>.<mp3|ogg|wav>.
Thiếu file thì game vẫn chạy: client hiện khung màu + emoji thay ảnh,
và phát âm thanh lật bài chung thay âm thanh riêng.
"""
import os
import random

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
IMAGE_DIR = os.path.join(BASE_DIR, 'static', 'memes', 'img')
SOUND_DIR = os.path.join(BASE_DIR, 'static', 'sounds')
# Ảnh meme dùng nguyên tấm làm lá bài (không in chữ). Có ảnh ở đây thì chỉ chơi bằng các ảnh này.
CARD_IMAGE_DIR = os.path.join(BASE_DIR, 'static', 'memes', 'cards')
IMAGE_EXTS = ('.jpg', '.jpeg', '.png', '.webp', '.gif')
SOUND_EXTS = ('.mp3', '.ogg', '.wav')

# Mẫu meme: khóa = tên file ảnh (không đuôi). emoji dùng khi chưa có ảnh.
MEME_TEMPLATES = {
    'drake': {'name': 'Drake Hotline Bling', 'emoji': '🙅'},
    'distracted': {'name': 'Distracted Boyfriend', 'emoji': '👀'},
    'brain': {'name': 'Expanding Brain', 'emoji': '🧠'},
    'yelling-cat': {'name': 'Woman Yelling at Cat', 'emoji': '😾'},
    'swole-cheems': {'name': 'Swole Doge vs Cheems', 'emoji': '🐕'},
    'gru': {'name': "Gru's Plan", 'emoji': '📋'},
    'this-is-fine': {'name': 'This Is Fine', 'emoji': '🔥'},
    'success-kid': {'name': 'Success Kid', 'emoji': '✊'},
    'crying': {'name': "I'm Not Crying", 'emoji': '😢'},
    'one-does-not': {'name': 'One Does Not Simply', 'emoji': '💍'},
    'y-u-no': {'name': 'Y U NO', 'emoji': '🙌'},
    'forever-alone': {'name': 'Forever Alone', 'emoji': '😭'},
    'they-dont-know': {'name': "They Don't Know", 'emoji': '🥤'},
    'stonks': {'name': 'Stonks', 'emoji': '📈'},
    'not-stonks': {'name': 'Not Stonks', 'emoji': '📉'},
    'spongebob': {'name': 'Mocking SpongeBob', 'emoji': '🧽'},
    'pikachu': {'name': 'Surprised Pikachu', 'emoji': '😮'},
    'butterfly': {'name': 'Is This a Pigeon?', 'emoji': '🦋'},
    'spiderman': {'name': 'Spider-Man Pointing', 'emoji': '🕷️'},
    'doubt': {'name': 'Press X to Doubt', 'emoji': '❌'},
    'monkey': {'name': 'Monkey Puppet', 'emoji': '🐒'},
    'gigachad': {'name': 'Gigachad', 'emoji': '🗿'},
    'sweating': {'name': 'Sweating', 'emoji': '😰'},
    'table-flip': {'name': 'Table Flip', 'emoji': '┻━┻'},
    'loss': {'name': 'Loss', 'emoji': '▮▮'},
    'anime-pointing': {'name': 'Anime Girl Pointing', 'emoji': '👉'},
    'sad': {'name': 'Sad Pablo Escobar', 'emoji': '😔'},
    'pooh': {'name': 'Tuxedo Winnie the Pooh', 'emoji': '🐻'},
}

# (mẫu meme, chú thích). Dấu " | " tách các khung của meme.
MEME_CARDS = [
    # Memes kinh điển
    ('forever-alone', "Me: exists | Tình cảm: có mục đích khác"),
    ('crying', "I'm not crying, you're crying"),
    ('this-is-fine', "This is fine 🔥"),
    ('one-does-not', "One does not simply..."),
    ('y-u-no', "Y U NO...?"),
    ('forever-alone', "Forever alone 😭"),

    # Success kid
    ('success-kid', "Woke up before the alarm"),
    ('success-kid', "Took the last slice of pizza"),
    ('success-kid', "Found $20 in old pants"),
    ('this-is-fine', "Email: All good | Reality: CHAOS"),

    # Distracted boyfriend
    ('distracted', "Me: đang tập trung | Bất kỳ thứ gì khác: 👀"),
    ('distracted', "Người yêu: Nhìn đây | Tôi: Nhìn điện thoại"),
    ('distracted', "Cô ấy: Tại sao bạn lặng lẽ? | Tôi: Chỉ suy nghĩ"),

    # Drake
    ('drake', "Spam notifications: 👎 | Muted notifications: 👍"),
    ('drake', "Thứ Hai sáng: 👎 | Thứ Sáu chiều: 👍"),
    ('drake', "Mới của bạn: 👎 | Cũ của tôi: 👍"),

    # Expanding brain
    ('brain', "Mở balo → Đóng balo → Mở rộng → KHÔNG THỂ ĐÓNG"),
    ('brain', "Thức dậy | Kiểm tra điện thoại | Hiểm nguy | Mô tả cuộc sống con người"),

    # Woman yelling at cat
    ('yelling-cat', "Mẹ tôi: yelling | Mèo: confused"),
    ('yelling-cat', "Boss: critiques | Me: exists"),

    # Sad meme
    ('sad', "Nhìn em lên: Có hy vọng | Nhìn em xuống: Sad life"),
    ('sad', "Bắt đầu hôm nay | Tuần sau: Quên rồi"),

    # Swole doge vs cheems
    ('swole-cheems', "Gym regular: RIPPED | Me: SMOL"),
    ('swole-cheems', "Lời hứa: Swole | Hiện thực: Cheems"),

    # Gru's plan
    ('gru', "Plan: Hoàn hảo | Kế hoạch công khai: Thất bại"),
    ('gru', "Thứ 1 → Thứ 2 → Thứ 3 → Thứ 4 (sứt mẻ)"),

    # Increasingly verbose
    ('pooh', "No | Negative | Unable to comply | Không thể hoàn thành yêu cầu"),
    ('pooh', "Yes | Affirmative | Acknowledged | Xác nhận được trình bày ở dạng mặc định"),

    # Loss
    ('loss', "4 bức ảnh của đàn ông"),
    ('loss', "standing | sitting | sitting | lying"),

    # Stonks
    ('stonks', "STONKS 📈"),
    ('not-stonks', "Not stonks 📉"),
    ('stonks', "Cá mập tài chính 🦈"),

    # Spongebob
    ('spongebob', "Mocking text | mOcKiNg TeXt"),
    ('spongebob', "When you're sarcastic | mE:"),

    # Surprised Pikachu
    ('pikachu', "I did something stupid | Shocked Pikachu face"),
    ('pikachu', "Làm điều xấu | Bị bắt lỗi | :O"),

    # They don't know
    ('they-dont-know', "Tôi ở đây | Tôi đang làm gì? | Họ không biết tôi yêu thích"),

    # Anime girl pointing
    ('anime-pointing', "Khi ai đó nói một điều thường thức"),
    ('anime-pointing', "Bây giờ nghe đây..."),

    # Anime sweating
    ('sweating', "Khi bạn trả lời không chính xác nhưng ai cũng im lặng"),
    ('sweating', "Căng thẳng từng giây"),

    # Table flip
    ('table-flip', "Bình tĩnh | Toát mồ hôi | Lật bàn"),

    # Brain levels
    ('brain', "Braindead | Average | Big brain | Cosmic brain | Omniscient"),

    # Increasingly unhinged
    ('brain', "Bình thường tôi | Sau 1 tách cà phê | Sau 5 tách"),

    # Happiness sounds
    ('table-flip', "Nếu bạn xóa đi | Tôi nổi điên"),
    ('success-kid', "Tiếng cười của một người yêu thích"),

    # Butterfly
    ('butterfly', "Là cái này? | Sự thất bại?"),

    # Spiderman pointing
    ('spiderman', "GitHub Copilot | Tôi | Cùng viết code"),

    # Press X to doubt
    ('doubt', "Tuyên bố của ai đó | X (nghi ngờ)"),

    # Monkey puppet
    ('monkey', "Giả vờ không thấy | Nhìn qua vai"),

    # Gigachad
    ('gigachad', "Người thông thường | Tôi | Sigma grindset"),
]


def find_asset(directory, basename, exts):
    """Tìm file <basename>.<đuôi> trong thư mục, trả về tên file hoặc None"""
    for ext in exts:
        if os.path.isfile(os.path.join(directory, basename + ext)):
            return basename + ext
    return None


def build_image_cards():
    """Mỗi ảnh trong static/memes/cards/ thành một lá bài chỉ có ảnh"""
    if not os.path.isdir(CARD_IMAGE_DIR):
        return []
    names = sorted(n for n in os.listdir(CARD_IMAGE_DIR) if n.lower().endswith(IMAGE_EXTS))
    return [{
        'id': index,
        'template': 'image',
        'name': '',
        'emoji': '🖼️',
        'caption': '',
        'image': f'/static/memes/cards/{name}',
        'sound': None,
    } for index, name in enumerate(names)]


def build_cards():
    """Tạo danh sách lá bài. Có ảnh trong static/memes/cards/ thì chỉ dùng ảnh,
    không thì dùng bộ lá mẫu meme + chú thích."""
    image_cards = build_image_cards()
    if image_cards:
        return image_cards
    cards = []
    for index, (template, caption) in enumerate(MEME_CARDS):
        info = MEME_TEMPLATES[template]
        image = find_asset(IMAGE_DIR, template, IMAGE_EXTS)
        sound = find_asset(SOUND_DIR, 'meme-' + template, SOUND_EXTS)
        cards.append({
            'id': index,
            'template': template,
            'name': info['name'],
            'emoji': info['emoji'],
            'caption': caption,
            'image': f'/static/memes/img/{image}' if image else None,
            'sound': f'/static/sounds/{sound}' if sound else None,
        })
    return cards


class Deck:

    def __init__(self, seed=None):
        # Truyền seed để xáo bài tái lập được (dùng cho test)
        self.rng = random.Random(seed)
        # Dò ảnh/âm thanh một lần khi tạo ván: thả file mới vào thì ván sau dùng được
        self.all_cards = build_cards()
        self.reset()

    def draw_card(self):
        """Rút 1 lá bài"""
        if self.current_index >= len(self.cards):
            # Nếu hết bài, reset bộ bài
            self.reset()

        card = self.cards[self.current_index]
        self.current_index += 1
        return dict(card)

    def reset(self):
        """Reset bộ bài"""
        self.cards = list(self.all_cards)
        self.rng.shuffle(self.cards)
        self.current_index = 0

    def draw_multiple(self, count):
        """Rút nhiều lá bài"""
        return [self.draw_card() for _ in range(count)]
