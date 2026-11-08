#!/bin/zsh
# Render one scene from a worktree into video/previews/<scene>-<tag>.mp4 plus a contact sheet.
# usage: preview.sh <worktree-path> <scene-id> <tag>
set -e
WT=$1; SCENE=$2; TAG=$3
OUT=/Users/mateovidal/orca/workspaces/makecu-guante/video/video/previews
cd $WT/video/studio
npx remotion render scene-$SCENE $OUT/$SCENE-$TAG.mp4 --log=error --concurrency=6
ffmpeg -v error -y -i $OUT/$SCENE-$TAG.mp4 -vf "fps=1,scale=640:-1,tile=4x4" -frames:v 1 $OUT/$SCENE-$TAG.png
echo $OUT/$SCENE-$TAG.mp4
