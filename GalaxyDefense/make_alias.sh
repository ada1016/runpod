#!/bin/bash



# 1. Define Aliases
#alias hook='cd ~/Documents/runpod/GalaxyDefense && PID=$(pgrep -n "GalaxyDefense") && lldb -p $PID --batch -o "process detach" -o "quit" && sleep 1 && frida -p $PID -l god.js'
#alias auto='cd ~/Documents/runpod/GalaxyDefense/autoclicker && python3 ./play.py'

# 2. Display Menu
echo "------------------------------------------"
echo "GalaxyDefense Command Center"
echo "------------------------------------------"
echo "1) Start hook"
echo "2) Start auto"
echo "3) Nothing"
echo "------------------------------------------"

# 3. Handle User Input
read -p "Select an option [1-3]: " choice

case $choice in
    1)
        echo "Executing Hook..."
        #cd ~/Documents/runpod/GalaxyDefense && PID=$(pgrep -n "GalaxyDefense") && lldb -p $PID --batch -o "process detach" -o "quit" && sleep 1 && sudo frida -p $PID -l god.js
        cd ~/Documents/runpod/GalaxyDefense && PID=$(pgrep -n "GalaxyDefense") &&  sleep 1 && sudo frida -p $PID -l god.js
        #cd ~/Documents/runpod/GalaxyDefense && PID=$(pgrep -n "GalaxyDefense") && lldb -p $PID --batch -o "process detach" -o "quit" && sleep 1 && frida -p $PID -l bypass_keychain.js
        ;;
    2)
        echo "Executing Auto..."
        cd ~/Documents/runpod/GalaxyDefense/autoclicker && python3 ./play.py
        ;;
    3)
        echo "Exiting. Aliases 'hook' and 'auto' are ready."
        ;;
    *)
        echo "Invalid selection."
        ;;
esac