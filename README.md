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
3. **Ra đề:** đầu mỗi vòng, người mở vòng gõ một chủ đề (ví dụ "Khi sếp nhắn lúc 11h đêm") cho cả phòng đọc. Mỗi vòng xoay sang người kế tiếp mở. Có nút 🎲 gợi ý đề; sau **45 giây** chưa gõ thì game tự chọn một đề
4. Bắt đầu từ người mở vòng, lần lượt mỗi người đánh 1 ảnh hợp với chủ đề
5. Tất cả người chơi khác bình chọn ảnh đó có hợp với chủ đề không; người đánh không bỏ phiếu cho lá của mình
6. **Bài bình thường**: Cần 3/4 người đồng ý → được +1 điểm
7. **Bài cuối cùng** (lá làm tay bạn hết bài): Chỉ cần 1/2 người đồng ý → thắng, ván kết thúc
8. Nếu lá bài bị từ chối, người chơi mất lượt và bị phạt **rút 2 lá** (tay bài nhiều hơn 1 lá so với trước khi đánh)
9. Ai rời phòng giữa ván thì phiếu của họ không còn được chờ; còn 1 người thì người đó thắng
10. Mỗi lượt bỏ phiếu có **30 giây**. Hết giờ, ai chưa vote thì không được tính; không ai vote thì lá bị từ chối

## Ảnh và âm thanh meme

- **Lá bài bằng ảnh (khuyên dùng):** thả ảnh meme bất kỳ (jpg, png, gif…) vào `static/memes/cards/`. Có ảnh ở đó thì mỗi ảnh là một lá bài, hiện nguyên tấm, không in chữ. Thư mục này không lên GitHub nên cập nhật game không mất ảnh.

- Ảnh: thả ảnh mẫu meme (ảnh trống) vào `static/memes/img/`, đặt tên theo mẫu, ví dụ `drake.jpg`.
- Âm thanh: `static/sounds/` (âm giao diện như `accept.mp3`, âm riêng từng meme như `meme-stonks.mp3`). Danh sách tên file ở [static/sounds/README.md](static/sounds/README.md).
- Danh sách đầy đủ tên file và chỗ ghi nguồn nằm trong [ASSETS.md](ASSETS.md). Thêm file nào thì điền một dòng ở đó.
- Thiếu file thì game vẫn chạy: lá bài hiện khung màu + emoji, âm thanh dùng tiếng bíp tổng hợp.
- Trong game có nút 🔊 (tắt tiếng), thanh âm lượng và nút ✨ (tắt hiệu ứng).

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
├── card_deck.py          # Bộ bài + mẫu meme
├── topics.py             # Đề gợi ý cho bước ra đề
├── ASSETS.md             # Danh sách ảnh/âm thanh và nguồn
├── tests/
│   ├── test_game_engine.py
│   └── test_assets.py
├── templates/
│   └── index.html        # UI game
└── static/
    ├── css/
    │   └── style.css
    ├── js/
    │   └── client.js
    ├── memes/img/        # Ảnh mẫu meme
    └── sounds/           # Âm thanh
```
