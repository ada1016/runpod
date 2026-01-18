import requests
import time
import base64
import os

class GenerateVideoClient:
    def __init__(self, runpod_endpoint_id, runpod_api_key):
        self.endpoint_id = runpod_endpoint_id
        self.headers = {
            "Authorization": f"Bearer {runpod_api_key}",
            "Content-Type": "application/json"
        }
        self.base_url = f"https://api.runpod.ai/v2/{runpod_endpoint_id}"

    def create_video_from_image(self, image_path, prompt, **kwargs):
        # 將圖片轉為 base64
        with open(image_path, "rb") as f:
            img_base64 = base64.b64encode(f.read()).decode('utf-8')

        # 這裡就是把所有參數打包送給 RunPod
        input_data = {
            "image": img_base64,
            "prompt": prompt,
            "negative_prompt": kwargs.get("negative_prompt", ""),
            "width": kwargs.get("width", 480),
            "height": kwargs.get("height", 832),
            "length": kwargs.get("length", 81),
            "steps": kwargs.get("steps", 10),
            "seed": kwargs.get("seed", 42),
            "cfg": kwargs.get("cfg", 2.0),
            "lora_pairs": kwargs.get("lora_pairs", [])  # 接收新參數
        }

        response = requests.post(f"{self.base_url}/run", headers=self.headers, json={"input": input_data})
        job_id = response.json().get("id")
        return self._wait_for_job(job_id)

    def _wait_for_job(self, job_id):
        while True:
            res = requests.get(f"{self.base_url}/status/{job_id}", headers=self.headers).json()
            if res.get("status") in ["COMPLETED", "FAILED"]:
                return res
            print("生成中...")
            time.sleep(2)

    def save_video_result(self, result, output_path):
            """
            將 API 回傳的數據（Base64 或 URL）轉存為影片檔案。
            如果檔名已存在，則自動編號（例如 output_1.mp4）。
            """
            output = result.get("output")
            if not output:
                print(f"❌ 錯誤：API 回傳結果中沒有 output 數據。")
                return

            video_data = None
            if isinstance(output, dict):
                video_data = output.get("video")
            elif isinstance(output, str):
                video_data = output

            if not video_data:
                print(f"❌ 錯誤：無法提取影片數據。")
                return

            # --- 自動更名邏輯 ---
            base, extension = os.path.splitext(output_path)
            counter = 1
            final_path = output_path
            
            while os.path.exists(final_path):
                final_path = f"{base}_{counter}{extension}"
                counter += 1
            
            # 之後所有的寫入操作都使用 final_path
            # ------------------

            try:
                if isinstance(video_data, str) and video_data.startswith("http"):
                    print(f"正在從網址下載影片...")
                    r = requests.get(video_data)
                    with open(final_path, "wb") as f:
                        f.write(r.content)
                else:
                    print(f"正在解碼 Base64 數據並儲存...")
                    if isinstance(video_data, str) and "," in video_data:
                        video_data = video_data.split(",")[1]
                    
                    with open(final_path, "wb") as f:
                        f.write(base64.b64decode(video_data))
                
                print(f"✅ 成功！影片已儲存至: {os.path.abspath(final_path)}")
                
                    
            except Exception as e:
                print(f"❌ 儲存影片時發生錯誤: {e}")