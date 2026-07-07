import { Stage, Layer, Circle, Rect, Text, Group } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useCanvasStore } from "./store";
import { socket } from "./socket";
import type { CanvasNode } from "./types";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
// Mirrors backend CANVAS_PADDING (layoutEngine.ts). This exceeds every shape's
// half-extent (circle radius 26, rectangle half-size 28/20), so clamping a
// shape's center to this box guarantees its visible edge never leaves the
// canvas — the same rule generation-time positions already follow.
const CANVAS_PADDING = 48;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export default function Canvas() {
  const nodes = useCanvasStore((s) => s.nodes);
  const moveNode = useCanvasStore((s) => s.moveNode);

  // Prevents the shape from ever being dragged outside canvas bounds, live
  // during the drag — not just clamped after the fact on drag end.
  function dragBoundFunc(pos: { x: number; y: number }) {
    return {
      x: clamp(pos.x, CANVAS_PADDING, CANVAS_WIDTH - CANVAS_PADDING),
      y: clamp(pos.y, CANVAS_PADDING, CANVAS_HEIGHT - CANVAS_PADDING),
    };
  }

  function handleDragEnd(node: CanvasNode, e: KonvaEventObject<DragEvent>) {
    const x = e.target.x();
    const y = e.target.y();

    moveNode(node.id, x, y);
    socket.emit("node:move", { id: node.id, x, y });
  }

  return (
    <div className="canvas-wrapper">
      <Stage width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="canvas-stage">
        <Layer>
          {nodes.map((node) => {
            if (node.type === "circle") {
              return (
                <Group
                  key={node.id}
                  x={node.x}
                  y={node.y}
                  draggable
                  dragBoundFunc={dragBoundFunc}
                  onDragEnd={(e) => handleDragEnd(node, e)}
                >
                  <Circle radius={node.radius} fill="#5B8DEF" stroke="#2E5CD4" strokeWidth={1.5} />
                  <Text
                    text={node.label}
                    fontSize={13}
                    fontFamily="'JetBrains Mono', monospace"
                    fill="#0B1220"
                    width={node.radius * 2}
                    height={node.radius * 2}
                    offsetX={node.radius}
                    offsetY={node.radius}
                    align="center"
                    verticalAlign="middle"
                  />
                </Group>
              );
            }

            return (
              <Group
                key={node.id}
                x={node.x}
                y={node.y}
                draggable
                dragBoundFunc={dragBoundFunc}
                onDragEnd={(e) => handleDragEnd(node, e)}
              >
                <Rect
                  width={node.width}
                  height={node.height}
                  fill="#F2A65A"
                  stroke="#C97D2E"
                  strokeWidth={1.5}
                  cornerRadius={4}
                />
                <Text
                  text={node.label}
                  fontSize={13}
                  fontFamily="'JetBrains Mono', monospace"
                  fill="#0B1220"
                  width={node.width}
                  height={node.height}
                  align="center"
                  verticalAlign="middle"
                />
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
