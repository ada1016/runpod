import runpod
import time
import sys
from generate_video_client import GenerateVideoClient

# 檢查是否有傳入參數，否則使用預設值
endpoint_id = sys.argv[1] if len(sys.argv) > 1 else "ik04l9es0bpylx"
api_key = sys.argv[2] if len(sys.argv) > 2 else "rpa_G9Q9KKTZT2Z8256M8LN76WT4E9ONUCVA0LJ0FHHU569s66"
from generate_video_client import GenerateVideoClient


# 1. 配置你的憑證
# API Key 可以在 RunPod Settings 找到
# Endpoint ID 在你部署好的 Endpoint 頁面標題下方 (例如: abc123def456)
runpod.api_key = api_key

endpoint = runpod.Endpoint(endpoint_id)

# 2. 準備輸入參數 (Payload)
# 根據該鏡像的結構，通常需要傳入圖片/影片的 URL 以及放大倍率
input_payload = {
    "input": {
        "task_type": "upscale",      # 任務類型：upscale 或 interpolation
        "input_url": "https://your-storage.com/image.jpg",
        "upscale_factor": 2,         # 放大倍率
        "model_name": "realesrgan",  # 或該鏡像支援的其他模型
        # 如果是補幀任務可能需要額外參數
        # "fps_factor": 2, 
    }
}

def run_sync_request():
    print("--- 正在發送請求至 RunPod ---")
    try:
        # 使用 run() 會自動等待結果 (Synchronous)
        # 如果任務很長，建議使用 run_async()
        request = endpoint.run(input_payload)
        
        print("任務已完成！")
        print("輸出結果:", request)
        
    except Exception as e:
        print(f"發生錯誤: {e}")

def run_async_request():
    print("--- 正在發送非同步請求 ---")
    job = endpoint.run_async(input_payload)
    job_id = job.job_id
    print(f"Job ID: {job_id}，正在排隊處理...")

    # 輪詢檢查狀態
    while True:
        status = job.status()
        if status == "COMPLETED":
            output = job.output()
            print("生成成功！結果 URL:", output)
            break
        elif status == "FAILED":
            print("任務失敗:", job.error())
            break
        else:
            print(f"當前狀態: {status}...")
            time.sleep(5)

if __name__ == "__main__":
    # 建議大型影像處理使用非同步模式，避免 Connection Timeout
    run_async_request()