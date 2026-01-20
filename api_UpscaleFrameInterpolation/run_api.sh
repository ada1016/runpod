# 1. 建立虛擬環境資料夾 (名稱叫 venv)
python3 -m venv venv

# 2. 啟動虛擬環境
source venv/bin/activate
pip install --upgrade pip  # 建議先升級 pip
pip install runpod
pip install -r requirements.txt

echo "python run_api.py [endpoint], [API_key]"
python run_api.py ik04l9es0bpylx rpa_G9Q9KKTZT2Z8256M8LN76WT4E9ONUCVA0LJ0FHHU569s66