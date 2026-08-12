#!/usr/bin/env sh
# Regenerates the README hero GIF from the committed live demo recording.
# The GIF is a 6x-speed derivation of nodeslide-demo-final.mp4 — no re-staging.
# Output stays under GitHub's 8MB inline-render cap.
cd "$(dirname "$0")"
ffmpeg -y -i nodeslide-demo-final.mp4 \
  -vf "setpts=PTS/6,fps=8,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" \
  nodeslide-demo-hero.gif
