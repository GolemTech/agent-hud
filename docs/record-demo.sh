#!/usr/bin/env bash
# Records docs/assets/demo.gif: runs docs/demo.tape, crops the frames to the
# sidebar dock and optimizes the GIF. Needs vhs, ffmpeg and gifsicle.
# Run from the repository root.
set -euo pipefail

full=docs/assets/demo-full.gif
out=docs/assets/demo.gif
# The dock's left edge in a 1600-pixel-wide recording (Claude Code seats the
# dock there at this width); measured from a recorded frame.
crop="crop=716:1195:884:10"

vhs docs/demo.tape
ffmpeg -loglevel error -y -i "$full" \
  -vf "$crop,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=none" \
  "$out.tmp.gif"
gifsicle -O3 --lossy=40 "$out.tmp.gif" -o "$out"
rm -f "$full" "$out.tmp.gif"
echo "wrote $out ($(du -h "$out" | cut -f1))"
