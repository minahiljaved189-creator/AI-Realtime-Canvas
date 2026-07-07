# Notes

## AI tool used

- **Claude** (Anthropic) — used for the full build: architecture, backend (Express + Socket.io + deterministic layout engine), frontend (React + TypeScript + react-konva + Zustand), and iteration/debugging against the assignment spec.
- **Groq (Llama 3.3 70B)** — the in-app LLM. It only extracts structured intent (`shape`, `layout`, `count`, optional `position`) from the user's natural-language prompt. It never produces coordinates — those are always computed deterministically in `backend/src/layoutEngine.ts`, which is what guarantees centered, non-overlapping, in-bounds layouts every time regardless of what the model returns.

## What I'd improve with more time

- **Multi-canvas / rooms** — right now all connected clients share one global canvas. A room/session concept (`?room=abc`) would let multiple independent groups work without colliding.
- **Undo/redo and shape deletion** — currently you can only regenerate the whole canvas or drag existing shapes; there's no way to remove a single shape or step back in history.
- **Persisted server-side state** — canvas state lives in memory on the server and resets on restart; a lightweight store (SQLite/Redis) would survive deploys and support multiple concurrent canvases.
- **Richer compound layouts** — the `groups` + `position` anchor system (center / above / below / left / right) handles the assignment's sample prompts, but a more general relative-positioning grammar ("2 circles to the left of the rectangles") would cover more phrasing without hardcoding anchors.
- **Optimistic multi-drag / presence indicators** — showing which user is currently dragging which shape (cursor labels, per-user color) would make multi-user sync feel more collaborative rather than just "eventually consistent."
- **Automated tests in CI** — the layout engine currently has a manual sanity script (bounds/labels/overlap checks across all layout×shape×count combinations); wiring that into a real test runner + GitHub Actions would catch regressions automatically on push.
