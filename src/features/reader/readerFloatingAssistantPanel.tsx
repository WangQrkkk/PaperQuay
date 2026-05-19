import { useEffect, useRef, useState } from 'react';
import { useLocaleText } from '../../i18n/uiLanguage';
import { ChatWorkspacePanel, type ChatWorkspacePanelProps } from './assistantSidebarChat';

function clampFloatingPosition(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getInitialFloatingAssistantPosition() {
  if (typeof window === 'undefined') {
    return { x: 960, y: 88 };
  }

  return {
    x: Math.max(16, window.innerWidth - Math.min(1040, window.innerWidth - 32)),
    y: 88,
  };
}

export type FloatingAssistantChatProps = ChatWorkspacePanelProps;

export interface FloatingAssistantPanelProps {
  title: string;
  onAttachAssistant: () => void;
  chatProps: FloatingAssistantChatProps;
}

export function FloatingAssistantPanel({
  title,
  onAttachAssistant,
  chatProps,
}: FloatingAssistantPanelProps) {
  const l = useLocaleText();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    panelX: number;
    panelY: number;
  } | null>(null);
  const [panelPosition, setPanelPosition] = useState(getInitialFloatingAssistantPosition);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragRef.current;

      if (!dragState) {
        return;
      }

      const panelRect = panelRef.current?.getBoundingClientRect();
      const panelWidth = panelRect?.width ?? 960;
      const panelHeight = panelRect?.height ?? 720;
      const nextX = dragState.panelX + event.clientX - dragState.startX;
      const nextY = dragState.panelY + event.clientY - dragState.startY;
      const maxX = Math.max(12, window.innerWidth - panelWidth - 12);
      const maxY = Math.max(64, window.innerHeight - panelHeight - 12);

      setPanelPosition({
        x: clampFloatingPosition(nextX, 12, maxX),
        y: clampFloatingPosition(nextY, 64, maxY),
      });
    };

    const handlePointerUp = () => {
      dragRef.current = null;
      setDragging(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [dragging]);

  useEffect(() => {
    const handleResize = () => {
      const panelRect = panelRef.current?.getBoundingClientRect();
      const panelWidth = panelRect?.width ?? 960;
      const panelHeight = panelRect?.height ?? 720;
      const maxX = Math.max(12, window.innerWidth - panelWidth - 12);
      const maxY = Math.max(64, window.innerHeight - panelHeight - 12);

      setPanelPosition((current) => ({
        x: clampFloatingPosition(current.x, 12, maxX),
        y: clampFloatingPosition(current.y, 64, maxY),
      }));
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div
      ref={panelRef}
      className="fixed z-40 flex h-[min(820px,calc(100vh-72px))] min-h-[560px] w-[min(1040px,calc(100vw-32px))] min-w-[640px] resize flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/96 shadow-[0_30px_90px_rgba(15,23,42,0.22)] backdrop-blur-2xl"
      style={{
        left: panelPosition.x,
        top: panelPosition.y,
      }}
    >
      <div
        className="flex cursor-move items-center justify-between gap-3 border-b border-slate-200/80 bg-slate-50/86 px-4 py-3"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) {
            return;
          }

          const panelRect = panelRef.current?.getBoundingClientRect();
          dragRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            panelX: panelRect?.left ?? panelPosition.x,
            panelY: panelRect?.top ?? panelPosition.y,
          };
          setDragging(true);
        }}
      >
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            {l('独立文档问答', 'Detached Document Chat')}
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-900">{title}</div>
        </div>
        <button
          type="button"
          onClick={onAttachAssistant}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-all duration-200 hover:bg-slate-50"
        >
          {l('停靠回右侧', 'Dock Back')}
        </button>
      </div>

      <div className="min-h-0 flex-1 bg-[linear-gradient(180deg,#fbfdff,#f5f8fc)]">
        <ChatWorkspacePanel
          {...chatProps}
          assistantDetached
          layoutMode="workspace"
        />
      </div>
    </div>
  );
}
