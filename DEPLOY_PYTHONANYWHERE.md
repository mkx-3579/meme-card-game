# Deploy trên PythonAnywhere - Hướng dẫn chi tiết

## Bước 1: Tạo GitHub Repo

```bash
cd c:\Users\Admin\meme-card-game
git init
git add .
git commit -m "Initial commit: Meme Card Game"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/meme-card-game.git
git push -u origin main
```

Thay `YOUR_USERNAME` bằng tên GitHub của bạn

---

## Bước 2: Đăng nhập PythonAnywhere & Tạo Web App

1. Truy cập: https://www.pythonanywhere.com/dashboard/
2. Click "Add a new web app"
3. Chọn "Manual configuration" → Python 3.10
4. Bạn sẽ nhận domain: `USERNAME.pythonanywhere.com`

---

## Bước 3: Upload Code

Trong **Bash console** trên PythonAnywhere:

```bash
# Clone repo
git clone https://github.com/YOUR_USERNAME/meme-card-game.git
cd meme-card-game

# Install dependencies
pip install -r requirements.txt

# Copy files vào /mysite
cp -r . /home/USERNAME/mysite/
cd /home/USERNAME/mysite
```

---

## Bước 4: Configure WSGI File

1. Vào **Web** tab → tìm "WSGI configuration file"
2. Edit file (nó sẽ mở trong editor)
3. Thay nội dung bằng:

```python
import sys
path = '/home/USERNAME/mysite'
sys.path.append(path)

from app import app, socketio

application = app
```

Thay `USERNAME` bằng tên PythonAnywhere của bạn

---

## Bước 5: Install Dependencies

1. Vào **Web** app settings
2. Tìm "Virtualenv"
3. Click "Create a new virtualenv for a Python web app" → Python 3.10

Hoặc trong Bash:
```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Set virtualenv path trong Web tab

---

## Bước 6: Configure Flask Settings

Trong **Files** tab, edit `/home/USERNAME/mysite/app.py`:

Thay:
```python
socketio.run(app, debug=True, host='0.0.0.0', port=5000)
```

Bỏ dòng này (Flask sẽ tự chạy)

---

## Bước 7: Reload Web App

1. Vào **Web** tab
2. Click **Reload** button

Xong! Game của bạn sẽ chạy ở: `https://USERNAME.pythonanywhere.com`

---

## Troubleshooting

**Lỗi: ModuleNotFoundError**
→ Kiểm tra virtualenv path, install packages lại

**Lỗi: Socket.IO connection failed**
→ Thêm vào app.py:
```python
socketio = SocketIO(app, 
                    cors_allowed_origins="*",
                    async_mode='threading',
                    transports=['polling'],
                    logger=False,
                    engineio_logger=False)
```

**Lỗi 500**
→ Check error log trong Web tab → "Error log"
