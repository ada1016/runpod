import requests
import json
import time
import base64
import os

# ================= 配置區 =================
API_KEY = "rpa_G9Q9KKTZT2Z8256M8LN76WT4E9ONUCVA0LJ0FHHU569s66"
ENDPOINT_ID = "o775vlugdpnnav"
JSON_FILE = "z_image_turbo LoRA - StevenV3_API.json"
INPUT_IMAGE_PATH = "/Users/mingdajiang/Documents/ComfyUI/input/result_b192b2e514c44d93b3faf8458c56fd75.png"  # 您要在 Mac 上選用的參考圖
OUTPUT_FILENAME = "/Users/mingdajiang/Documents/ComfyUI/output/result_v3.png"

# 設定要開啟的 LoRA (1: Alice, 2: Angie, 3: Apple, 4: Ava)
ACTIVE_LORA_INDEX = 1  
LORA_STRENGTH = 1.0
# ==========================================

def image_to_base64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode('utf-8')

def send_runpod_request():
    # 1. 載入原始 JSON 內容
    with open(JSON_FILE, 'r') as f:
        workflow = json.load(f)

    # 2. 處理圖片輸入 (Node 33)
    # 將本地圖片轉為 Base64 並直接放入 workflow
    if os.path.exists(INPUT_IMAGE_PATH):
        b64_img = image_to_base64(INPUT_IMAGE_PATH)
        workflow["33"]["inputs"]["image"] = f"data:image/png;base64,{b64_img}"
    else:
        print(f"⚠️ 警告：找不到輸入圖片 {INPUT_IMAGE_PATH}，將使用 JSON 中的預設值。")

    # 3. 動態開關 LoRA (Node 47)
    # 先全部關閉，再開啟指定的那個
    for i in range(1, 5):
        key = f"lora_{i}"
        if key in workflow["47"]["inputs"]:
            workflow["47"]["inputs"][key]["on"] = (i == ACTIVE_LORA_INDEX)
            workflow["47"]["inputs"][key]["strength"] = LORA_STRENGTH
    
    # 獲取當前使用的 LoRA 名稱用於 Log
    active_name = workflow["47"]["inputs"][f"lora_{ACTIVE_LORA_INDEX}"]["lora"]
    print(f"🎨 當前選用 LoRA: {active_name} (強度: {LORA_STRENGTH})")

    # 4. 準備發送請求
    payload = {"input": {"workflow": workflow}}
    url = f"https://api.runpod.ai/v1/{ENDPOINT_ID}/runsync"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }

    print("🚀 請求已發送至 RunPod，請稍候...")
    start_time = time.time()
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=120)
        response.raise_for_status()
        result = response.json()

        if result.get("status") == "COMPLETED":
            # 5. 解析回傳圖片
            # 註：根據 runpod-worker-comfyui 的預設 handler，圖片通常在 output.message 裡
            output = result.get("output", {})
            images = output.get("message", []) # 某些版本可能在 output.images

            if images:
                img_data = base64.b64decode(images[0])
                with open(OUTPUT_FILENAME, "wb") as f:
                    f.write(img_data)
                duration = round(time.time() - start_time, 2)
                print(f"✅ 生成成功！耗時 {duration} 秒。圖片已存至: {OUTPUT_FILENAME}")
            else:
                print("❌ 任務完成但未找到圖片。請檢查 RunPod 端的 handler 輸出格式。")
        else:
            print(f"❌ 任務失敗: {result.get('error', '未知錯誤')}")

    except Exception as e:
        print(f"💥 發生錯誤: {str(e)}")

if __name__ == "__main__":
    send_runpod_request()