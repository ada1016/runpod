from generate_video_client import GenerateVideoClient

# 1. 初始化 (保持不變)
client = GenerateVideoClient(
    runpod_endpoint_id="6x34mn7mvzz44f",
    runpod_api_key="rpa_G9Q9KKTZT2Z8256M8LN76WT4E9ONUCVA0LJ0FHHU569s66"
)

# 2. 定義新版 Release Note 提到的 LoRA Pairs
# 這裡填入你放在 /workspace/temp/models/loras 裡的真實檔名
lora_pairs = [
    {
        "high": "wan_t2v_A14B_separate_high_noise_lora_ava.safetensors", 
        "low": "wan_t2v_A14B_separate_low_noise_lora_ava.safetensors",
        "high_weight": 1.0,
        "low_weight": 0.8
    }
]

# 3. 呼叫函數 (加入 lora_pairs 參數)
result = client.create_video_from_image(
    image_path="./ComfyUI_00007_.png",
    prompt="sks_ava, beautiful nude asian girl, perfect proportions, small firm breasts, hard pink nipples, completely exposed pussy, legs spread very wide in M-shape pose, both arms raised and stretched upward, wrists crossed above head, vulnerable and aroused expression, heavy breathing, glistening wet pussy, subtle hip thrusting motion, bedroom at night, warm dim lighting, cinematic depth of field, explicit genitals, ultra detailed anatomy, photorealistic, masterpiece",
    negative_prompt="blurry, distorted",
    width=480,
    height=832,
    length=81,
    steps=10,
    seed=42,
    cfg=2.0,
    lora_pairs=lora_pairs  # <-- 關鍵：把這組設定傳進去
)

# 4. 儲存結果
if result.get('status') == 'COMPLETED':
    client.save_video_result(result, "./output_video_with_lora.mp4")
else:
    print(f"Error: {result.get('error')}")