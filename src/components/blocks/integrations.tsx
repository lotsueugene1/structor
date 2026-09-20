"use client";

import {
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { ArrowUpRight, Info, Rotate3D, X } from "lucide-react";
import {
  motion,
  useReducedMotion,
  useSpring,
  type MotionStyle,
} from "motion/react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { integrations, type Integration } from "@/lib/integrations";

type Pose = { x: number; y: number; z: number };

const restPose: Pose = { x: 16, y: -6, z: 6 };
const spring = { stiffness: 220, damping: 26, mass: 0.7 };
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function ToolLogo({ id }: { id: string }) {
  return (
    <span
      aria-hidden="true"
      className="integration-logo"
      style={{ "--tool-logo": `url(/integrations/${id}.svg)` } as CSSProperties}
    />
  );
}

function ToolCard({
  tool,
  onOpenChange,
}: {
  tool: Integration;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <li className="integration-grid-item">
      <Dialog onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <Button
            variant="stack"
            size="tile"
            className="integration-card"
            static
            aria-label={`${tool.name} MCP setup guide`}
          />
        </DialogTrigger>
        <DialogContent className="integration-guide" showCloseButton={false}>
          <div className="integration-guide-topline">
            <Badge variant="outline">MCP · Planned</Badge>
            <DialogClose asChild>
              <Button
                variant="ghost"
                size="icon-lg"
                aria-label="Close setup guide"
              >
                <X />
              </Button>
            </DialogClose>
          </div>
          <DialogHeader>
            <div className="integration-guide-brand">
              <ToolLogo id={tool.id} />
              <DialogTitle>Connect Structor to {tool.name}</DialogTitle>
            </div>
            <DialogDescription>
              Setup reference for the planned Structor MCP server.
            </DialogDescription>
          </DialogHeader>
          <Alert role="note">
            <Info />
            <AlertTitle>Structor MCP is not live yet.</AlertTitle>
            <AlertDescription>
              The server URL and authentication method will be added when the
              service ships.
            </AlertDescription>
          </Alert>
          <ol
            className="integration-guide-steps"
            aria-label="Connection setup steps"
          >
            {tool.steps.map((step, index) => (
              <li key={step.title}>
                <span aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="integration-config-location">
            <span>Configuration</span>
            <code>{tool.configFile}</code>
            <p>{tool.configHint}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" asChild>
              <a href={tool.docs} target="_blank" rel="noopener noreferrer">
                Official MCP docs <ArrowUpRight data-icon="inline-end" />
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <span className="integration-card-artwork" aria-hidden="true">
        <span className="integration-card-depth" />
        <span className="integration-card-face">
          <span className="integration-card-index">MCP</span>
          <ArrowUpRight className="integration-card-arrow" size={15} />
          <ToolLogo id={tool.id} />
          <span className="integration-card-name">{tool.name}</span>
        </span>
      </span>
    </li>
  );
}

export function Integrations() {
  const reducedMotion = useReducedMotion();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const rotateX = useSpring(restPose.x, spring);
  const rotateY = useSpring(restPose.y, spring);
  const rotateZ = useSpring(restPose.z, spring);
  const poseRef = useRef<Pose>({ ...restPose });
  const suppressClickRef = useRef(false);
  const dragRef = useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    startPose: { ...restPose },
    lastPose: { ...restPose },
    moved: false,
    captured: false,
  });

  function setPose(pose: Pose) {
    rotateX.set(pose.x);
    rotateY.set(pose.y);
    rotateZ.set(pose.z);
    dragRef.current.lastPose = pose;
  }

  function returnToSavedPose() {
    setPose(poseRef.current);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (reducedMotion || dialogOpen) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    setInteracting(true);
    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPose: { ...poseRef.current },
      lastPose: { ...poseRef.current },
      moved: false,
      captured: false,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (reducedMotion || dialogOpen) return;
    const drag = dragRef.current;
    if (drag.active && drag.pointerId === event.pointerId) {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.hypot(dx, dy) > 5) {
        drag.moved = true;
        if (!drag.captured) {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.captured = true;
        }
      }
      setPose({
        x: clamp(drag.startPose.x - dy * 0.14, -28, 32),
        y: clamp(drag.startPose.y + dx * 0.16, -36, 36),
        z: clamp(drag.startPose.z + dx * 0.025 - dy * 0.015, -12, 12),
      });
      return;
    }
    if (event.pointerType !== "mouse") return;
    if ((event.target as Element).closest(".integration-card")) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = clamp(
      (event.clientX - bounds.left) / bounds.width - 0.5,
      -0.5,
      0.5,
    );
    const y = clamp(
      (event.clientY - bounds.top) / bounds.height - 0.5,
      -0.5,
      0.5,
    );
    setPose({
      x: poseRef.current.x - y * 8,
      y: poseRef.current.y + x * 10,
      z: poseRef.current.z + x * 2 - y * 1.5,
    });
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    poseRef.current = { ...drag.lastPose };
    suppressClickRef.current = drag.moved;
    drag.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setInteracting(event.pointerType === "mouse");
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }

  function cancelDrag() {
    dragRef.current.active = false;
    suppressClickRef.current = false;
    setInteracting(false);
    returnToSavedPose();
  }

  function suppressDraggedClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  }

  function handleOpenChange(open: boolean) {
    setDialogOpen(open);
    setInteracting(false);
    returnToSavedPose();
  }

  const planeStyle: MotionStyle = {
    transformPerspective: 1200,
    rotateX: reducedMotion ? restPose.x : rotateX,
    rotateY: reducedMotion ? restPose.y : rotateY,
    rotateZ: reducedMotion ? restPose.z : rotateZ,
  };

  return (
    <section
      className="integrations-section"
      id="context"
      aria-labelledby="integrations-heading"
    >
      <div className="integrations-layout container">
        <header className="integrations-heading">
          <span className="integration-kicker">MCP integrations</span>
          <h2 id="integrations-heading">
            Works with your favorite coding tool.
          </h2>
          <p>Select a tool to view its Structor MCP setup.</p>
        </header>
        <div
          className="integration-scene"
          aria-describedby="integration-instructions"
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse" && !reducedMotion) {
              setInteracting(true);
            }
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={cancelDrag}
          onPointerLeave={() => {
            if (!dragRef.current.active) {
              setInteracting(false);
              returnToSavedPose();
            }
          }}
          onClickCapture={suppressDraggedClick}
          onFocusCapture={(event) => {
            if (event.target.matches(":focus-visible")) returnToSavedPose();
          }}
        >
          <motion.div
            className={
              interacting
                ? "integration-plane is-interacting"
                : "integration-plane"
            }
            style={planeStyle}
          >
            <ul
              className="integration-grid"
              aria-label="Coding tools with MCP setup guides"
            >
              {integrations.map((tool) => (
                <ToolCard
                  key={tool.id}
                  tool={tool}
                  onOpenChange={handleOpenChange}
                />
              ))}
            </ul>
          </motion.div>
          <p className="integration-instructions" id="integration-instructions">
            <Rotate3D size={15} strokeWidth={1.7} aria-hidden="true" />
            Drag to rotate · select a tool
          </p>
        </div>
      </div>
    </section>
  );
}
