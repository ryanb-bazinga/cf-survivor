#!/bin/bash
# Double-click this file in Finder to preview the site locally.
# Serves this folder at http://localhost:8765 and opens your browser.
# Close this Terminal window (or press Ctrl+C) when you're done.
#
# A local server is needed because the page loads its standings from the
# data/ folder at runtime. Opening index.html straight off the disk is
# blocked by the browser and the page comes up empty.

cd "$(dirname "$0")" || { echo "Could not enter the site folder."; read -r; exit 1; }

PORT=8765
URL="http://localhost:$PORT/"
LOG="$(mktemp -t cf-survivor-preview)"

pause_and_exit() {
  echo
  read -r -p "Press Return to close this window."
  exit "${1:-1}"
}

# Already serving? Just open it.
if curl -s -o /dev/null --max-time 2 "$URL"; then
  echo "Preview is already running. Opening $URL"
  open "$URL"
  exit 0
fi

# Find an interpreter that actually RUNS. On macOS /usr/bin/python3 can
# exist as a stub that only prompts to install developer tools, so
# checking the path is not enough; each candidate is executed.
SERVER=()
if python3 -c "import sys" >/dev/null 2>&1; then
  SERVER=(python3 -m http.server "$PORT")
elif php --version >/dev/null 2>&1; then
  SERVER=(php -S "localhost:$PORT")
elif ruby --version >/dev/null 2>&1; then
  SERVER=(ruby -run -e httpd . -p "$PORT")
elif command -v npx >/dev/null 2>&1; then
  SERVER=(npx --yes http-server -p "$PORT" -c-1)
fi

if [ ${#SERVER[@]} -eq 0 ]; then
  echo
  echo "  No working web server found on this Mac."
  echo
  echo "  Two ways to fix it, either is fine:"
  echo
  echo "  1. Install Apple's developer tools, which include python3."
  echo "     Run this, then accept the prompt that appears:"
  echo
  echo "         xcode-select --install"
  echo
  echo "  2. Open this folder in VS Code and install the"
  echo "     'Live Server' extension, then right-click index.html"
  echo "     and choose 'Open with Live Server'."
  echo
  pause_and_exit 1
fi

echo
echo "  CF Survivor League, local preview"
echo "  Serving: $(pwd)"
echo "  Using:   ${SERVER[0]}"
echo

"${SERVER[@]}" >"$LOG" 2>&1 &
SERVER_PID=$!

# Stop the server when this window closes or Ctrl+C is pressed.
trap 'kill $SERVER_PID 2>/dev/null; rm -f "$LOG"' EXIT INT TERM

# Wait for it to actually accept connections before opening the browser.
for _ in $(seq 1 40); do
  if curl -s -o /dev/null --max-time 1 "$URL"; then
    READY=1
    break
  fi
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    break
  fi
  sleep 0.25
done

if [ -z "$READY" ]; then
  echo "  The server did not start. Here is what it said:"
  echo
  sed 's/^/      /' "$LOG"
  echo
  echo "  If the port is in use, another preview may already be running."
  pause_and_exit 1
fi

echo "  Ready at $URL"
echo
echo "  Refresh your browser to pick up changes."
echo "  Press Ctrl+C, or close this window, when you're done."
echo

open "$URL"

wait $SERVER_PID
