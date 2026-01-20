from generate_video_client import GenerateVideoClient

# 1. 初始化 (保持不變)
client = GenerateVideoClient(
    runpod_endpoint_id="f01vlwxnwwqsp4",
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
    prompt="sks_ava, A woman is lying on her back with her legs spread looking up at the viewer. She has black hair and is wearing a black lace bra and a pink lace thong. The woman pulls down her bra strap with her right hand as her firm perky breasts flop out and are fully visible.",
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