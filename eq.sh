#!/bin/bash
# Simple terminal equalizer animation in Bash
# Press 'q' to quit

NUM_BARS=20
MAX_HEIGHT=15
REFRESH_RATE=0.1

heights=()
for ((i=0; i<NUM_BARS; i++)); do
    heights[i]=0
done

trap "tput cnorm; clear; exit" INT

hide_cursor() {
    tput civis
}

show_cursor() {
    tput cnorm
}

draw_bars() {
    local h
    clear
    for ((y=MAX_HEIGHT; y>0; y--)); do
        line=""
        for h in "${heights[@]}"; do
            if (( h >= y )); then
                line+=$'\e[32m█\e[0m '
            else
                line+="  "
            fi
        done
        echo -e "$line"
    done
}

hide_cursor
while true; do
    for ((i=0; i<NUM_BARS; i++)); do
        delta=$((RANDOM % 5 - 2))
        heights[i]=$((heights[i] + delta))
        if (( heights[i] < 0 )); then heights[i]=0; fi
        if (( heights[i] > MAX_HEIGHT )); then heights[i]=MAX_HEIGHT; fi
    done
    draw_bars
    read -t "$REFRESH_RATE" -n 1 key
    if [[ $key == 'q' ]]; then
        break
    fi
    key=""
    sleep "$REFRESH_RATE"
done
show_cursor
clear
