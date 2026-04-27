import { useEffect } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';

interface UseTauriPdfDropOptions {
  onPdfPaths: (paths: string[]) => void;
  onDragStateChange?: (active: boolean) => void;
}

function isPdfPath(path: string): boolean {
  return path.trim().toLowerCase().endsWith('.pdf');
}

export function useTauriPdfDrop({
  onPdfPaths,
  onDragStateChange,
}: UseTauriPdfDropOptions) {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'enter' || event.payload.type === 'over') {
          onDragStateChange?.(true);
          return;
        }

        if (event.payload.type === 'leave') {
          onDragStateChange?.(false);
          return;
        }

        onDragStateChange?.(false);

        const pdfPaths = event.payload.paths.filter(isPdfPath);

        if (pdfPaths.length > 0) {
          onPdfPaths(pdfPaths);
        }
      })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }

        unlisten = nextUnlisten;
      })
      .catch(() => {
        onDragStateChange?.(false);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [onDragStateChange, onPdfPaths]);
}
