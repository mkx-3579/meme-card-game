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

1. Cần 2–8 người chơi. Người tạo phòng (👑) là người bấm bắt đầu; đã bắt đầu thì không vào thêm được
2. Mỗi người chơi nhận 5 lá bài meme
3. Lần lượt, mỗi người chơi đánh 1 lá bài
4. Tất cả người chơi khác bình chọn (hợp lệ/không hợp lệ); người đánh không bỏ phiếu cho lá của mình
5. **Bài bình thường**: Cần 3/4 người đồng ý → được +1 điểm
6. **Bài cuối cùng** (lá làm tay bạn hết bài): Chỉ cần 1/2 người đồng ý → thắng, ván kết thúc
7. Nếu lá bài bị từ chối, người chơi mất lượt và rút 1 lá bài mới
8. Ai rời phòng giữa ván thì phiếu của họ không còn được chờ; còn 1 người thì người đó thắng

## Chạy test

```bash
python -m unittest discover -s tests
```

## Cấu trúc project

```
meme-card-game/
├── app.py                 # Flask app chính
├── requirements.txt       # Dependencies
├── game_engine.py        # Game logic
├── card_deck.py          # Bộ bài
├── tests/
│   └── test_game_engine.py
├── templates/
│   └── index.html        # UI game
└── static/
    ├── css/
    │   └── style.css
    └── js/
        └── client.js
```
