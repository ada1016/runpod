import runpod
import time
import sys


# 檢查是否有傳入參數，否則使用預設值
endpoint_id = sys.argv[1] if len(sys.argv) > 1 else "ik04l9es0bpylx"
api_key = sys.argv[2] if len(sys.argv) > 2 else "rpa_G9Q9KKTZT2Z8256M8LN76WT4E9ONUCVA0LJ0FHHU569s66"


# 1. 配置你的憑證
# API Key 可以在 RunPod Settings 找到
# Endpoint ID 在你部署好的 Endpoint 頁面標題下方 (例如: abc123def456)
runpod.api_key = api_key

endpoint = runpod.Endpoint(endpoint_id)

# 2. 準備輸入參數 (Payload)
# 根據該鏡像的結構，通常需要傳入圖片/影片的 URL 以及放大倍率
input_payload = {
    "input": {
        "task_type": "upscale_and_interpolation",
        "upscale_factor": 2,
        "video_path": "/runpod-volume/temp/clean_video.mp4",
        "network_volume": true
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
    print("--- 正在發送請求 (非同步模式) ---")
    
    # 在新版 SDK 中，直接使用 run 即可發起任務並獲得 job 對象
    # 注意：某些版本可能需要使用 endpoint.run(input_payload) 
    # 如果 run() 直接阻塞了，請改用下面這行：
    job = endpoint.run(input_payload) 
    
    # 獲取 Job ID
    job_id = job.job_id
    print(f"Job ID: {job_id}，正在排隊處理...")

    # 輪詢檢查狀態
    while True:
        # 使用 job.status() 獲取當前狀態
        status = job.status()
        
        if status == "COMPLETED":
            output = job.output()
            print("\n生成成功！")
            print("結果:", output)
            break
        elif status == "FAILED":
            print("\n任務失敗:", job.error())
            break
        else:
            # 這裡做一個簡單的進度條視覺效果
            print(f"當前狀態: {status}...", end="\r")
            time.sleep(5)

if __name__ == "__main__":
    # 建議大型影像處理使用非同步模式，避免 Connection Timeout
    run_sync_request()