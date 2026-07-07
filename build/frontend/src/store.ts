import { create } from "zustand";
import type { CanvasNode, CanvasState } from "./types";

const STORAGE_KEY = "ai-realtime-canvas:nodes";

function loadPersisted(): CanvasNode[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CanvasNode[]) : [];
  } catch {
    return [];
  }
}

function persist(nodes: CanvasNode[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes));
  } catch {
    // localStorage may be unavailable (private mode, quota) — fail silently.
  }
}

interface CanvasStore {
  nodes: CanvasNode[];
  isGenerating: boolean;
  error: string | null;
  setNodes: (nodes: CanvasNode[]) => void;
  moveNode: (id: string, x: number, y: number) => void;
  setGenerating: (value: boolean) => void;
  setError: (message: string | null) => void;
}

export const useCanvasStore = create<CanvasStore>((set) => ({
  nodes: loadPersisted(),
  isGenerating: false,
  error: null,

  setNodes: (nodes) => {
    persist(nodes);
    set({ nodes });
  },

  moveNode: (id, x, y) =>
    set((state) => {
      const nodes = state.nodes.map((n) => (n.id === id ? { ...n, x, y } : n));
      persist(nodes);
      return { nodes };
    }),

  setGenerating: (value) => set({ isGenerating: value }),
  setError: (message) => set({ error: message }),
}));

export function applyCanvasState(state: CanvasState) {
  useCanvasStore.getState().setNodes(state.nodes);
}
