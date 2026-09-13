# Meme Card Game 🎮

Một trò chơi bài online với chủ đề meme, nơi người chơi đánh bài và mọi người bình chọn tính hợp lệ của lá bài.

## Yêu cầu

- Python 3.8+
- pip

## Cài đặt

```bash
pip install -r requirements.txt
```

## Chạy game

```bash
python app.py
```

Sau đó truy cập: `http://localhost:5000`

## Luật chơi

1. Mỗi người chơi nhận 5 lá bài meme
2. Lần lượt, mỗi người chơi đánh 1 lá bài
3. Tất cả người chơi khác bình chọn (hợp lệ/không hợp lệ)
4. **Bài bình thường**: Cần 3/4 người đồng ý → được tính điểm
5. **Bài cuối cùng** (lá bài thứ 5): Chỉ cần 1/2 người đồng ý → thắng
6. Nếu lá bài bị từ chối, người chơi mất lượt và rút 1 lá bài mới

## Cấu trúc project

```
meme-card-game/
├── app.py                 # Flask app chính
├── requirements.txt       # Dependencies
├── game_engine.py        # Game logic
├── card_deck.py          # Bộ bài
├── templates/
│   └── index.html        # UI game
└── static/
    ├── css/
    │   └── style.css
    └── js/
        └── client.js
```
