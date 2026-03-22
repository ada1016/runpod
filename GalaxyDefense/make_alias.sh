#!/bin/bash

# 1. Define Aliases
# Using 'alias' allows you to type 'hook' or 'auto' manually in the terminal later
alias hook='cd ~/Documents/runpod/GalaxyDefense && PID=$(pgrep -n "GalaxyDefense") && lldb -p $PID --batch -o "process detach" -o "quit" && sleep 1 && frida -p $PID -l god.js'
alias auto='cd ~/Documents/runpod/GalaxyDefense/autoclicker && python3 ./play.py'

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
        # Running the command directly since aliases don't always expand inside the script that defines them
        hook
        ;;
    2)
        echo "Executing Auto..."
        auto
        ;;
    3)
        echo "Exiting. You can still use 'hook' or 'auto' manually."
        ;;
    *)
        echo "Invalid selection."
        ;;
esac