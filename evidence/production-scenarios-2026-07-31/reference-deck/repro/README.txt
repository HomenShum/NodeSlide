NodeSlide reference deck reproduction

1. Set SKILL_DIR to the installed Presentations skill directory.
2. Create an isolated artifact-tool workspace:
   node "$SKILL_DIR/container_tools/setup_artifact_tool_workspace.mjs" --workspace .
3. Run the deck builder with the bundled Codex Node runtime:
   node build.mjs
4. Verify the exported PowerPoint:
   python "$SKILL_DIR/container_tools/slides_test.py" ../NodeSlide-From-Signal-to-Defensible-Decision.pptx
   python "$SKILL_DIR/container_tools/render_slides.py" ../NodeSlide-From-Signal-to-Defensible-Decision.pptx

The generated hero asset is vendored under assets/. The deck contains no externally sourced factual claims; repository and live-QA inputs are listed in source-notes.txt.
