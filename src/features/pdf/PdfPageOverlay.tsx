import type {
  PaperAnnotation,
  PdfHighlightTarget,
  PositionedMineruBlock,
} from '../../types/reader';
import { bboxToCssStyle, type PageSize } from '../../utils/bbox';
import { cn } from '../../utils/cn';
import { resolveBBoxBaseSize } from './pdfViewerUtils';

type LocaleText = (zh: string, en: string) => string;

interface PdfPageOverlayProps {
  pageIndex: number;
  originalPage: PageSize;
  renderedPage: PageSize;
  pageBlocks: PositionedMineruBlock[];
  pageAnnotations: PaperAnnotation[];
  activeBlockId: string | null;
  hoveredBlockId: string | null;
  selectedAnnotationId: string | null;
  activeHighlight: PdfHighlightTarget | null;
  activeHighlightSource: PdfHighlightTarget | PositionedMineruBlock | null;
  allowLinkedInteractions: boolean;
  onAnnotationSelect?: (annotationId: string) => void;
  l: LocaleText;
}

export function PdfPageOverlay({
  pageIndex,
  originalPage,
  renderedPage,
  pageBlocks,
  pageAnnotations,
  activeBlockId,
  hoveredBlockId,
  selectedAnnotationId,
  activeHighlight,
  activeHighlightSource,
  allowLinkedInteractions,
  onAnnotationSelect,
  l,
}: PdfPageOverlayProps) {
  return (
    <div className="paperquay-page-overlay relative h-full w-full pointer-events-none">
      {pageBlocks.map((block) => (
        <div
          key={block.blockId}
          aria-label={block.blockId}
          className={cn(
            'absolute rounded-lg border transition-all duration-150',
            hoveredBlockId === block.blockId && 'border-amber-300 bg-amber-200/18',
            activeBlockId === block.blockId &&
              'border-indigo-400 bg-indigo-300/14 shadow-[0_0_0_1px_rgba(99,102,241,0.18)]',
            hoveredBlockId !== block.blockId &&
              activeBlockId !== block.blockId &&
              'border-transparent bg-transparent',
          )}
          style={bboxToCssStyle(
            block.bbox!,
            resolveBBoxBaseSize(block, originalPage),
            renderedPage,
          )}
        />
      ))}

      {pageAnnotations.map((annotation, index) => {
        const isNoteAnchor = annotation.id.startsWith('note-anchor:');
        const annotationStyle = bboxToCssStyle(
          annotation.bbox,
          resolveBBoxBaseSize(annotation, originalPage),
          renderedPage,
        );
        const annotationTitle =
          annotation.note ||
          annotation.quote ||
          l(`批注 ${index + 1}`, `Annotation ${index + 1}`);

        if (isNoteAnchor) {
          return (
            <div
              key={annotation.id}
              className={cn(
                'pointer-events-none absolute rounded-lg border-2 transition-all duration-150',
                selectedAnnotationId === annotation.id
                  ? 'border-amber-500 bg-amber-200/18 shadow-[0_0_0_1px_rgba(245,158,11,0.20)]'
                  : 'border-amber-300/80 bg-amber-200/10',
              )}
              style={annotationStyle}
              title={annotationTitle}
            >
              {allowLinkedInteractions ? (
                <button
                  type="button"
                  data-annotation-ui="true"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onAnnotationSelect?.(annotation.id);
                  }}
                  className="pointer-events-auto absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white shadow-sm transition hover:bg-amber-600"
                  title={annotationTitle}
                >
                  {index + 1}
                </button>
              ) : null}
            </div>
          );
        }

        return (
          <button
            key={annotation.id}
            type="button"
            data-annotation-ui="true"
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onAnnotationSelect?.(annotation.id);
            }}
            className={cn(
              'absolute rounded-lg border-2 transition-all duration-150',
              allowLinkedInteractions ? 'pointer-events-auto' : 'pointer-events-none',
              selectedAnnotationId === annotation.id
                ? 'border-amber-500 bg-amber-200/18 shadow-[0_0_0_1px_rgba(245,158,11,0.20)]'
                : 'border-amber-300/90 bg-amber-200/10 hover:bg-amber-200/16',
            )}
            style={annotationStyle}
            title={annotationTitle}
          >
            <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white shadow-sm">
              {index + 1}
            </span>
          </button>
        );
      })}

      {activeHighlight && activeHighlight.pageIndex === pageIndex && activeHighlightSource ? (
        <div
          className="absolute z-[5] rounded-lg border-2 border-indigo-500 bg-indigo-200/18 shadow-[0_0_0_1px_rgba(79,70,229,0.18)]"
          style={bboxToCssStyle(
            activeHighlight.bbox,
            resolveBBoxBaseSize(activeHighlightSource, originalPage),
            renderedPage,
          )}
        />
      ) : null}
    </div>
  );
}
