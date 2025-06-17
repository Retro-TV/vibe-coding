import curses
import random
import time

# Configuration
NUM_BARS = 20
MAX_HEIGHT = 15
REFRESH_RATE = 0.1  # seconds


def draw_bars(stdscr, heights):
    stdscr.clear()
    for i, h in enumerate(heights):
        for y in range(MAX_HEIGHT):
            char = '█' if MAX_HEIGHT - y <= h else ' '
            if MAX_HEIGHT - y <= h:
                stdscr.addstr(y, i * 2, char, curses.color_pair(1))
            else:
                stdscr.addstr(y, i * 2, char)
    stdscr.refresh()


def main(stdscr):
    curses.curs_set(0)
    curses.start_color()
    curses.init_pair(1, curses.COLOR_GREEN, curses.COLOR_BLACK)
    heights = [0] * NUM_BARS
    while True:
        # Randomly vary heights
        heights = [max(0, min(MAX_HEIGHT, h + random.randint(-2, 2))) for h in heights]
        draw_bars(stdscr, heights)
        key = stdscr.getch()
        if key == ord('q'):
            break
        time.sleep(REFRESH_RATE)


if __name__ == '__main__':
    curses.wrapper(main)
