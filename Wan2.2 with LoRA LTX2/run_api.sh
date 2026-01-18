# 1. 建立虛擬環境資料夾 (名稱叫 venv)
python3 -m venv venv

# 2. 啟動虛擬環境
source venv/bin/activate
pip install --upgrade pip  # 建議先升級 pip
pip install -r requirements.txt
python run_api.py