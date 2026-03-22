import pyautogui
import time
import os
from pynput import mouse, keyboard

RECORD_FILE = "recording.txt"

# Data storage
captured_lines = [] 
base_point = None
region_start = None  
current_keys = set()

def on_click(x, y, button, pressed):
    global base_point
    # First Left Click sets the persistent Base XY
    if button == mouse.Button.left and pressed and base_point is None:
        base_point = (int(x), int(y))
        print(f"\n[BASE SET] Origin locked at: X: {base_point[0]} Y: {base_point[1]}")

def on_press(key):
    global base_point, region_start
    try:
        char = key.char.lower() if hasattr(key, 'char') and key.char else None
        shift_down = any(k in [keyboard.Key.shift, keyboard.Key.shift_r] for k in current_keys)

        if not shift_down or not char:
            return

        # 1. Shift + M: Mark Point
        if char == 'm':
            if base_point is None:
                print("\n[!] Set BASE first with Left-Click.")
                return
            
            x, y = pyautogui.position()
            dx, dy = int(x - base_point[0]), int(y - base_point[1])
            count = len(captured_lines) + 1
            
            output = f"[POINT MARKED] X: {x:>4} Y: {y:>4} | ΔX: {dx:>4} ΔY: {dy:>4} | Points: {count}"
            captured_lines.append(output)
            print(f"\n{output}")

        # 2. Shift + I: Mark Region Top-Left
        elif char == 'i':
            x, y = pyautogui.position()
            region_start = (int(x), int(y))
            print(f"\n[REGION START] Top-Left set at {region_start}. Move to Bottom-Right and press Shift + O")

        # 3. Shift + O: Mark Region Bottom-Right
        elif char == 'o':
            if region_start is None:
                print("\n[!] Press Shift + I first!")
                return
            if base_point is None:
                print("\n[!] Set BASE first with Left-Click.")
                return

            x2, y2 = pyautogui.position()
            x1, y1 = region_start
            
            # Calculate width and height
            w = abs(int(x2) - x1)
            h = abs(int(y2) - y1)
            
            # Delta refers to Top-Left relative to Base Point
            dx, dy = x1 - base_point[0], y1 - base_point[1]
            
            output = f"[REGINE MARKED] X: {x1:>4} Y: {y1:>4} to X1: {int(x2):>4} Y1: {int(y2):>4} | ΔX: {dx:>4} ΔY: {dy:>4} | REGINE ({x1}, {y1}, {w}, {h})"
            captured_lines.append(output)
            print(f"\n{output}")
            region_start = None 

        # 4. Shift + X: Exit without saving
        elif char == 'x':
            print("\n[EXIT] Emergency Stop. Data NOT saved.")
            os._exit(0)

        # 5. Shift + W: Write and Exit
        elif char == 'w':
            if not captured_lines:
                print("\n[EMPTY] Nothing to record.")
            else:
                with open(RECORD_FILE, "w") as f:
                    for line in captured_lines:
                        f.write(line + "\n")
                print(f"\n[SUCCESS] Saved {len(captured_lines)} entries to {RECORD_FILE}.")
            os._exit(0)

    except Exception as e:
        pass

def store_key(key): current_keys.add(key); on_press(key)
def remove_key(key): 
    if key in current_keys: current_keys.remove(key)

def start_recorder():
    print("--- Pro Hybrid Region Recorder ---")
    print("1. Left-Click : Set [BASE] XY")
    print("2. Shift + M  : Mark [POINT] (XY + Offset)")
    print("3. Shift + I  : Mark [REGION] Top-Left")
    print("4. Shift + O  : Mark [REGION] Bottom-Right")
    print("5. Shift + W  : Write & Exit | Shift + X : Cancel")
    print("-" * 60)

    m_listener = mouse.Listener(on_click=on_click)
    m_listener.start()

    with keyboard.Listener(on_press=store_key, on_release=remove_key) as k_listener:
        try:
            while True:
                mx, my = pyautogui.position()
                status = f"X: {mx:>4} Y: {my:>4}"
                if base_point:
                    status += f" | ΔX: {mx-base_point[0]:>4} ΔY: {my-base_point[1]:>4}"
                else:
                    status += " | [CLICK TO SET BASE]"
                
                print(f"\r{status} | Entries: {len(captured_lines)}      ", end="", flush=True)
                time.sleep(0.05)
        except KeyboardInterrupt:
            os._exit(0)

if __name__ == "__main__":
    start_recorder()