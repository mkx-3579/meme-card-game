"""
Bộ bài meme cho game
"""
import random

# Bộ bài với chủ đề meme
MEME_CARDS = [
    # Memes kinh điển
    "Me: exists | Tình cảm: có mục đích khác",
    "I'm not crying, you're crying",
    "This is fine 🔥",
    "One does not simply...",
    "Y U NO...?",
    "Forever alone 😭",
    
    # Success kid
    "Woke up before the alarm",
    "Took the last slice of pizza",
    "Found $20 in old pants",
    "Email: All good | Reality: CHAOS",
    
    # Distracted boyfriend
    "Me: đang tập trung | Bất kỳ thứ gì khác: 👀",
    "Người yêu: Nhìn đây | Tôi: Nhìn điện thoại",
    "Cô ấy: Tại sao bạn lặng lẽ? | Tôi: Chỉ suy nghĩ",
    
    # Drake
    "Spam notifications: 👎 | Muted notifications: 👍",
    "Thứ Hai sáng: 👎 | Thứ Sáu chiều: 👍",
    "Mới của bạn: 👎 | Cũ của tôi: 👍",
    
    # Expanding brain
    "Mở balo → Đóng balo → Mở rộng → KHÔNG THỂ ĐÓNG",
    "Thức dậy | Kiểm tra điện thoại | Hiểm nguy | Mô tả cuộc sống con người",
    
    # Woman yelling at cat
    "Mẹ tôi: yelling | Mèo: confused",
    "Boss: critiques | Me: exists",
    
    # Sad meme
    "Nhìn em lên: Có hy vọng | Nhìn em xuống: Sad life",
    "Bắt đầu hôm nay | Tuần sau: Quên rồi",
    
    # Swole doge vs cheems
    "Gym regular: RIPPED | Me: SMOL",
    "Lời hứa: Swole | Hiện thực: Cheems",
    
    # Gru's plan
    "Plan: Hoàn hảo | Kế hoạch công khai: Thất bại",
    "Thứ 1 → Thứ 2 → Thứ 3 → Thứ 4 (sứt mẻ)",
    
    # Increasingly verbose
    "No | Negative | Unable to comply | Không thể hoàn thành yêu cầu",
    "Yes | Affirmative | Acknowledged | Xác nhận được trình bày ở dạng mặc định",
    
    # Loss
    "4 bức ảnh của đàn ông",
    "standing | sitting | sitting | lying",
    
    # Stonks
    "STONKS 📈",
    "Not stonks 📉",
    "Cá mập tài chính 🦈",
    
    # Spongebob
    "Mocking text | mOcKiNg TeXt",
    "When you're sarcastic | mE:",
    
    # Surprised Pikachu
    "I did something stupid | Shocked Pikachu face",
    "Làm điều xấu | Bị bắt lỗi | :O",
    
    # They don't know
    "Tôi ở đây | Tôi đang làm gì? | Họ không biết tôi yêu thích",
    
    # Anime girl pointing
    "Khi ai đó nói một điều thường thức",
    "Bây giờ nghe đây...",
    
    # Anime sweating
    "Khi bạn trả lời không chính xác nhưng ai cũng im lặng",
    "Căng thẳng từng giây",
    
    # Table flip
    "Bình tĩnh | Toát mồ hôi | Lật bàn",
    
    # Brain levels
    "Braindead | Average | Big brain | Cosmic brain | Omniscient",
    
    # Increasingly unhinged
    "Bình thường tôi | Sau 1 tách cà phê | Sau 5 tách",
    
    # Happiness sounds
    "Nếu bạn xóa đi | Tôi nổi điên",
    "Tiếng cười của một người yêu thích",
    
    # Butterfly
    "Là cái này? | Sự thất bại?",
    
    # Spiderman pointing
    "GitHub Copilot | Tôi | Cùng viết code",
    
    # Press X to doubt
    "Tuyên bố của ai đó | X (nghi ngờ)",
    
    # Monkey puppet
    "Giả vờ không thấy | Nhìn qua vai",
    
    # Gigachad
    "Người thông thường | Tôi | Sigma grindset",
]

class Deck:
    """Quản lý bộ bài meme"""
    
    def __init__(self):
        self.cards = MEME_CARDS.copy()
        random.shuffle(self.cards)
        self.current_index = 0
    
    def draw_card(self):
        """Rút 1 lá bài"""
        if self.current_index >= len(self.cards):
            # Nếu hết bài, reset bộ bài
            self.reset()
        
        card = self.cards[self.current_index]
        self.current_index += 1
        return card
    
    def reset(self):
        """Reset bộ bài"""
        self.cards = MEME_CARDS.copy()
        random.shuffle(self.cards)
        self.current_index = 0
    
    def draw_multiple(self, count):
        """Rút nhiều lá bài"""
        return [self.draw_card() for _ in range(count)]
