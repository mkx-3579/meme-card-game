# Âm thanh

Thả file `.mp3`, `.ogg` hoặc `.wav` vào thư mục này, đặt đúng tên dưới đây. Thiếu file nào thì game tự phát âm tổng hợp thay thế.

| Tên file | Phát khi | Gợi ý tìm (pixabay.com/sound-effects, mixkit.co) |
|----------|----------|------------------------------------------------|
| `deal` | Chia bài đầu ván | "card shuffle", "cards dealing" |
| `card-play` | Có người đánh một lá ra bàn | "card flip", "whoosh slap" |
| `topic` | Có chủ đề mới cho vòng | "notification ding", "bell" |
| `your-turn` | Đến lượt bạn đánh bài | "pop", "ui notification" |
| `your-topic` | Đến lượt bạn ra chủ đề | "fanfare short", "trumpet notification" |
| `draw` | Rút thêm lá (bỏ lượt, bị phạt, chia bài) | "card slide", "card draw" |
| `vote` | Bạn bấm bỏ phiếu | "click", "button" |
| `drumroll` | 5 giây cuối khi bỏ phiếu | "drum roll" |
| `tick` | 3 giây cuối, nếu bạn chưa bỏ phiếu hoặc chưa ra đề | "clock tick" |
| `accept` | Lá được chấp nhận | "crowd laugh", "applause", "ta-da" |
| `reject` | Lá bị từ chối | "sad trombone", "wah wah", "crowd boo" |
| `win` | Có người thắng | "victory fanfare", "winning" |

- **Nhiều bản cho một âm:** thêm `<tên>-2` và `<tên>-3` (ví dụ `accept.mp3`, `accept-2.mp3`, `accept-3.mp3`), game sẽ chọn ngẫu nhiên mỗi lần phát cho đỡ nhàm.
- **Âm thanh riêng từng meme mẫu:** `meme-<mẫu>.mp3`, ví dụ `meme-stonks.mp3`. Thiếu thì phát tiếng `card-play`.
- Nên chọn file ngắn (dưới 3 giây, riêng `drumroll` khoảng 2 đến 5 giây) và nhẹ (dưới 200 KB).

Mỗi file thêm vào phải có một dòng trong `ASSETS.md` (test sẽ kiểm tra).
