import pyautogui
import time
import os
import random
import sys
from pynput import mouse, keyboard  # Added keyboard for hotkey
import subprocess
import threading
import Quartz # Required for window detection
# --- CONFIGURATION ---
BASE_XY = None 
MAX_RUNS = None
runs_completed = 0
IS_PVP = False 

REGIONS = {
    "HIGH": (0, 0, 770, 200),
    "LOW":  (0, 700, 800, 300)
}

CLICK_SETS = {
    "3_POINTS": [(190, 545), (390, 545), (580, 545)],
    "6_POINTS": [(219, 500), (385, 500), (550, 500), (300, 750), (480, 750), (400, 1000)]
}

IMAGE_CONFIG_DEFAULT = {
    "choose_card.png": {
        "region": REGIONS["HIGH"],
        "action_type": "RANDOM",
        "target_sequence": "3_POINTS",
        "confidence": 0.7,
        "desc":"選擇卡牌",
        "icon":"🈶"  
    },
    "level_up.png": {
        "region": REGIONS["HIGH"],
        "action_type": "RANDOM",
        "target_sequence": "3_POINTS",
        "confidence": 0.7,
        "desc":"等級提升",
        "icon":"🈶"
    },
    "extra_chance.png": {
        "region": REGIONS["HIGH"],
        "action_type": "SEQUENCE",
        "target_sequence": "6_POINTS",
        "confidence": 0.7,
        "desc":"額外機會",
        "icon":"🈶"
    },
    "battle_start.png": {
        "region": REGIONS["LOW"],
        "action_type": "CLICK_IMAGE",
        "confidence": 0.6,
        "desc":"開始戰鬥",
        "icon":"🎉"
    },
    "next.png": {
        "region": REGIONS["LOW"],
        "action_type": "CLICK_IMAGE",
        "confidence": 0.7,
         "desc":"回合結束 返回",
         "icon":"🎉"
    },
    "double.png": {
        "region": REGIONS["LOW"],
        "action_type": "CLICK_IMAGE",
        "confidence": 0.7,
         "desc":"回合結束 雙倍獎勵",
         "icon":"🎉"
    },
    "battle_return.png": {
        "region": REGIONS["LOW"],
        "action_type": "CLICK_IMAGE",
        "confidence": 0.7,
         "desc":"回合結束 返回",
         "icon":"🎉"
    }

}

IMAGE_CONFIG_PVP = {
    "match.png": {
        "region": REGIONS["LOW"],
        "action_type": "CLICK_IMAGE",
        "confidence": 0.6,
        "desc":"PVP 開始",
        "icon":"🈶"  
    },
    "click_space.png": {
        "region": REGIONS["LOW"],
        "action_type": "CLICK_IMAGE",
        "confidence": 0.6,
        "desc":"點擊空白結束",
        "icon":"🈶"
    },
    "battle_return.png": {
        "region": REGIONS["LOW"],
        "action_type": "CLICK_IMAGE",
        "confidence": 0.7,
         "desc":"回合結束 返回",
         "icon":"🎉"
    }    
}

# --- HOTKEY LOGIC ---
def start_hotkey_listener():
    """Listens for Shift + X to kill the script immediately."""
    current_keys = set()

    def on_press(key):
        current_keys.add(key)
        # Check if both Shift and 'X' are pressed
        shift_down = any(k in [keyboard.Key.shift, keyboard.Key.shift_r] for k in current_keys)
        x_down = any(hasattr(k, 'char') and k.char and k.char.lower() == 'x' for k in current_keys)
        
        if shift_down and x_down:
            print("\n[FORCE EXIT] Shift + X detected. Stopping script...")
            os._exit(0)

    def on_release(key):
        if key in current_keys:
            current_keys.remove(key)

    listener = keyboard.Listener(on_press=on_press, on_release=on_release)
    listener.daemon = True # Ensure listener dies when main thread ends
    listener.start()

# --- UTILS ---
def capture_base():
    print("--- Initialization ---")
    print("Please LEFT-CLICK on the game window's Top-Left anchor point...")
    selected_base = [None]
    def on_click(x, y, button, pressed):
        if button == mouse.Button.left and pressed:
            selected_base[0] = (int(x), int(y))
            return False 
    with mouse.Listener(on_click=on_click) as listener:
        listener.join()
    return selected_base[0]

def get_abs_region(region_offset):
    bx, by = BASE_XY
    dx, dy, w, h = region_offset
    return (bx + dx, by + dy, w, h)

def get_abs_point(point_offset):
    return (BASE_XY[0] + point_offset[0], BASE_XY[1] + point_offset[1])

def process_screen(start_time):
    global runs_completed

    for img_name, config in IMAGE_CONFIG.items():
        if not os.path.exists(img_name):
            continue
        target_region = get_abs_region(config["region"])
        try:
            #print(f"[*] Scanning for: {img_name}...", end="")
            location = pyautogui.locateOnScreen(
                img_name, 
                region=target_region, 
                confidence=config.get("confidence", 0.7)
            )
            if location:
                elapsed = int(time.time() - start_time)
                m, s = divmod(elapsed, 60)
                timestamp = f"[{m:02d}:{s:02d}]"
                print(f"\r{timestamp} [{config['icon']}] {config['desc']}  - Action: {config['action_type']}                                ", end="", flush=True)
                
                if config["action_type"] == "CLICK_IMAGE":
                    # --- NEW LOGIC: Check for Battle Return ---
                    if img_name in ["battle_return.png"]:
                        #take_photo()  
                        runs_completed += 1
                        if MAX_RUNS and runs_completed >= MAX_RUNS:
                            print(f"\n\n[✅ FINISHED] Completed {MAX_RUNS} runs. Stopping script.")
                            os._exit(0)
                    px, py = pyautogui.center(location)
                    #print(pyautogui.center(location))
                    pyautogui.click(px, py, clicks=2, interval=0.2)
                    if img_name in ["battle_start.png"] and IS_PVP:
                        time.sleep(2)
                        pyautogui.dragRel(200, 0, duration=0.8, button='left')
                elif config["action_type"] == "RANDOM":
                    points = CLICK_SETS[config["target_sequence"]]
                    abs_x, abs_y = get_abs_point(random.choice(points))
                    pyautogui.click(abs_x, abs_y, duration=0.2)
                    time.sleep(2)
                    pyautogui.dragRel(125, 0, duration=1, button='left')
                elif config["action_type"] == "SEQUENCE":
                    for offset in CLICK_SETS[config["target_sequence"]]:
                        abs_x, abs_y = get_abs_point(offset)
                        pyautogui.click(abs_x, abs_y)
                        time.sleep(0.3)
                return True 
        except (pyautogui.ImageNotFoundException, Exception):
            continue
    return False


def background_save(rect, ss_name):
    """
    WORKER THREAD: This runs independently of the main monitoring loop.
    It handles the heavy lifting of talking to macOS and writing to disk.
    """
    try:
        # The '-x' flag keeps it silent (no camera shutter sound)
        # We use 'check=True' so that if macOS returns an error, it triggers our except block
        subprocess.run(
            ["screencapture", "-R", rect, "-t", "jpg", "-x", ss_name], 
            check=True, 
            capture_output=True # Captures internal errors for debugging
        )

    except subprocess.CalledProcessError as e:
        # This catches macOS-specific errors (like permission denied)
        print(f"\n⚠️ [macOS Error] screencapture failed. Code: {e.returncode}")
    except Exception as e:
        # This catches Python-specific errors (like directory permission issues)
        print(f"\n⚠️ [Thread Error] Unexpected failure: {e}")

def take_photo():
    """
    MAIN THREAD: This triggers the background worker and returns immediately.
    """
    global BASE_XY
    bx, by = BASE_XY
    
    # Setup directory paths
    current_dir = os.path.dirname(os.path.abspath(__file__))
    target_dir = os.path.join(current_dir, "screenshots")
    
    if not os.path.exists(target_dir):
        try:
            os.makedirs(target_dir)
        except Exception as e:
            print(f"\n⚠️ Failed to create directory: {e}")
            return

    # Generate filename and capture region
    ss_name = os.path.join(target_dir, f"result_{int(time.time())}.jpg")
    rect = f"{bx},{by},785,1050"

    # --- THE MULTI-THREAD MAGIC ---
    # We create the thread, assign the target function, and pass the data.
    # daemon=True ensures that if you force-quit the script, the thread won't hang.
    save_thread = threading.Thread(
        target=background_save, 
        args=(rect, ss_name), 
        daemon=True
    )
    save_thread.start()



def take_photo_old():
    bx, by = BASE_XY
    current_dir = os.path.dirname(os.path.abspath(__file__))
    target_dir = os.path.join(current_dir, "screenshots")
    
    if not os.path.exists(target_dir):
        os.makedirs(target_dir)

    # Use .jpg for faster writes and smaller file size
    ss_name = os.path.join(target_dir, f"final_result_{int(time.time())}.jpg")
    
    try:
        # -R: region (x,y,w,h)
        # -t: file format (jpg)
        # -x: do not play the shutter sound
        rect = f"{bx},{by},785,1050"
        subprocess.run(["screencapture", "-R", rect, "-t", "jpg", "-x", ss_name], check=True)

        if os.path.exists(ss_name):
            print(f"\r[{m:02d}:{s:02d}] [📸] Photo Taken ...                                ", end="", flush=True)
            # Optional: open it immediately to verify
            # subprocess.run(["open", ss_name])
        else:
            print("❌ Screenshot failed: File was not created.")
    except Exception as e:
        print(f"⚠️ Error during capture: {e}")

# --- NEW AUTO-DETECTION LOGIC ---
def capture_base_auto(target_process_names=["Galaxy Defense", "GalaxyDefense"]):
    """
    Automatically finds the X, Y coordinates of the game window.
    """
    print(f"--- Searching for {target_process_names} ---")
    
    # Get a list of all windows currently on screen
    window_list = Quartz.CGWindowListCopyWindowInfo(
        Quartz.kCGWindowListExcludeDesktopElements | Quartz.kCGWindowListOptionOnScreenOnly, 
        Quartz.kCGNullWindowID
    )

    for window in window_list:
        owner_name = window.get('kCGWindowOwnerName', '')
        # Check if the process name matches our list
        if any(name in owner_name for name in target_process_names):
            bounds = window.get('kCGWindowBounds')
            if bounds:
                # bounds is a dictionary: {'X': 100, 'Y': 200, 'Width': 800, 'Height': 600}
                x = int(bounds['X'])
                y = int(bounds['Y'])
                print(f"[✅] Found Window: {owner_name} at ({x}, {y})")
                return (x, y)

    print("[❌] Could not find the game window. Is the game running?")
    return None


# --- MAIN SECTION ---
if __name__ == "__main__":
    args = [arg.lower() for arg in sys.argv]

    # Mode Setup
    if "pvp" in args:
        IS_PVP = True
        IMAGE_CONFIG = IMAGE_CONFIG_PVP
        mode_str = "PVP ⚔️"
    else:
        IS_PVP = False
        IMAGE_CONFIG = IMAGE_CONFIG_DEFAULT
        mode_str = "Normal 🚀"

    # Run Count Setup
    for arg in args[1:]:
        if arg.isdigit():
            MAX_RUNS = int(arg)
            break
    
    print(f"[ℹ️] Mode: {mode_str} | Limit: {MAX_RUNS if MAX_RUNS else 'Infinite'}")

    # Automatic Detection
    BASE_XY = capture_base_auto(["Galaxy Defense", "GalaxyDefense"])
    
    if BASE_XY is None:
        print("\n[❌] ERROR: Could not find 'Galaxy Defense' window.")
        print("Please make sure the game is open and visible on screen.")
        sys.exit()

    print(f"\n[🚀READY🚀] Base Auto-detected at: {BASE_XY}")
    print("🔥🔥Hotkeys: [Shift + X] to Force Exit🔥🔥")
    
    start_hotkey_listener()
    take_photo() # Initial snap
    
    time.sleep(2)
    start_time = time.time()
    
    try:
        while True:
            found = process_screen(start_time)
            if not found:
                elapsed = int(time.time() - start_time)
                m, s = divmod(elapsed, 60)
                print(f"\r[{m:02d}:{s:02d}] [⏳] Monitoring...                                ", end="", flush=True)
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nStopping...")


'''
# --- MAIN ---
if __name__ == "__main__":
# Convert all arguments to lowercase for easy checking
    args = [arg.lower() for arg in sys.argv]

    # --- MODE CHECK ---
    if "pvp" in args:
        IS_PVP = True
        IMAGE_CONFIG = IMAGE_CONFIG_PVP
        mode_str = "PVP ⚔️"
    else:
        IS_PVP = False
        IMAGE_CONFIG = IMAGE_CONFIG_DEFAULT
        mode_str = "Normal 🚀"
    #print (IMAGE_CONFIG)
    # --- RUN COUNT CHECK ---
    # Look for any argument that is a pure number
    for arg in args[1:]:
        if arg.isdigit():
            MAX_RUNS = int(arg)
            break
    
    # --- FINAL SUMMARY ---
    if MAX_RUNS:
        print(f"[ℹ️] Mode: {mode_str} | Limit: {MAX_RUNS} runs")
    else:
        print(f"[∞] Mode: {mode_str} | Limit: Infinite")


    BASE_XY = capture_base()
    if BASE_XY is None:
        sys.exit()

    print(f"\n[🚀READY🚀] Base set to: {BASE_XY}")
    print("🔥🔥Hotkeys: [Shift + X] to Force Exit🔥🔥")
    print("🔥🔥Starting Monitoring in 2 seconds..." )

    take_photo()
    # Start the hotkey listener in the background
    start_hotkey_listener()
    
    time.sleep(2)
    start_time = time.time()
    try:
        while True:
            found = process_screen(start_time)
            if not found:
                elapsed = int(time.time() - start_time)
                m, s = divmod(elapsed, 60)
                print(f"\r[{m:02d}:{s:02d}] [⏳] Monitoring...                                ", end="", flush=True)
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nStopping...")

'''