'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { EyeIcon, EyeOffIcon, GripVerticalIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  BLOCK_LABELS,
  DEFAULT_CONTAINER,
  canPlaceBlock,
  type InvoiceBlockId,
  type InvoiceLayout,
  type InvoiceLayoutContainer,
} from '@/lib/billing/invoice-layout';

/* -------------------------------------------------------------------------- */
/* Container <-> layout conversion                                            */
/* -------------------------------------------------------------------------- */

type Containers = Record<InvoiceLayoutContainer, InvoiceBlockId[]>;

const CONTAINER_IDS: InvoiceLayoutContainer[] = [
  'headerLeft',
  'headerRight',
  'aboveTable',
  'belowTable',
  'hidden',
];

function layoutToContainers(l: InvoiceLayout): Containers {
  return {
    headerLeft: [...l.header.left],
    headerRight: [...l.header.right],
    aboveTable: [...l.aboveTable],
    belowTable: [...l.belowTable],
    hidden: [...l.hidden],
  };
}

function containersToLayout(c: Containers, logoAlign?: InvoiceLayout['logoAlign']): InvoiceLayout {
  return {
    version: 1,
    header: { left: c.headerLeft, right: c.headerRight },
    aboveTable: c.aboveTable,
    belowTable: c.belowTable,
    hidden: c.hidden,
    ...(logoAlign ? { logoAlign } : {}),
  };
}

function isContainerId(id: UniqueIdentifier): id is InvoiceLayoutContainer {
  return (CONTAINER_IDS as string[]).includes(String(id));
}

function findContainer(
  containers: Containers,
  id: UniqueIdentifier,
): InvoiceLayoutContainer | null {
  if (isContainerId(id)) return id;
  return CONTAINER_IDS.find((c) => containers[c].includes(id as InvoiceBlockId)) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Editor                                                                     */
/* -------------------------------------------------------------------------- */

export type InvoiceLayoutEditorProps = {
  /** Initial layout — the editor is uncontrolled (remount via `key` to reset). */
  defaultValue: InvoiceLayout;
  onChange: (next: InvoiceLayout) => void;
  /** Brand tokens, for the live preview only. */
  primaryColor: string;
  fontFamily: string;
  headerText: string;
};

/**
 * Drag-and-drop invoice layout board. The user arranges blocks across the
 * header (two columns), above/below the fixed line-items table, and a Hidden
 * tray. Disallowed drops (e.g. a body block into the header) are rejected so the
 * result is always a valid `InvoiceLayout`. A scaled live preview mirrors the
 * arrangement. Uncontrolled: seed via `defaultValue`, notify via `onChange`.
 */
export function InvoiceLayoutEditor({
  defaultValue,
  onChange,
  primaryColor,
  fontFamily,
  headerText,
}: InvoiceLayoutEditorProps) {
  const [containers, setContainers] = useState<Containers>(() => layoutToContainers(defaultValue));
  const [activeId, setActiveId] = useState<InvoiceBlockId | null>(null);
  const logoAlign = defaultValue.logoAlign;

  // Notify the parent on any change without looping on a fresh `onChange` ref.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    onChangeRef.current(containersToLayout(containers, logoAlign));
  }, [containers, logoAlign]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart(e: DragStartEvent) {
    setActiveId(e.active.id as InvoiceBlockId);
  }

  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const block = active.id as InvoiceBlockId;
    const from = findContainer(containers, active.id);
    const to = findContainer(containers, over.id);
    if (!from || !to || from === to) return;
    if (!canPlaceBlock(block, to)) return; // reject illegal cross-zone drops

    setContainers((prev) => {
      const fromItems = prev[from];
      const toItems = prev[to];
      const overIndex = isContainerId(over.id)
        ? toItems.length
        : (() => {
            const i = toItems.indexOf(over.id as InvoiceBlockId);
            return i >= 0 ? i : toItems.length;
          })();
      return {
        ...prev,
        [from]: fromItems.filter((b) => b !== block),
        [to]: [...toItems.slice(0, overIndex), block, ...toItems.slice(overIndex)],
      };
    });
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveId(null);
    if (!over) return;
    const from = findContainer(containers, active.id);
    const to = findContainer(containers, over.id);
    if (!from || !to) return;
    if (from === to && active.id !== over.id) {
      setContainers((prev) => {
        const items = prev[to];
        const oldIndex = items.indexOf(active.id as InvoiceBlockId);
        const newIndex = items.indexOf(over.id as InvoiceBlockId);
        if (oldIndex < 0 || newIndex < 0) return prev;
        return { ...prev, [to]: arrayMove(items, oldIndex, newIndex) };
      });
    }
  }

  function toggleHidden(id: InvoiceBlockId) {
    setContainers((prev) => {
      const from = findContainer(prev, id);
      if (!from) return prev;
      if (from === 'hidden') {
        const target = DEFAULT_CONTAINER[id];
        return {
          ...prev,
          hidden: prev.hidden.filter((b) => b !== id),
          [target]: [...prev[target], id],
        };
      }
      return {
        ...prev,
        [from]: prev[from].filter((b) => b !== id),
        hidden: [...prev.hidden, id],
      };
    });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(220px,260px)]">
        {/* The board */}
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Zone
              id="headerLeft"
              title="Header — left"
              items={containers.headerLeft}
              onToggle={toggleHidden}
            />
            <Zone
              id="headerRight"
              title="Header — right"
              items={containers.headerRight}
              onToggle={toggleHidden}
            />
          </div>
          <Zone
            id="aboveTable"
            title="Above the table"
            items={containers.aboveTable}
            onToggle={toggleHidden}
          />
          <div className="text-muted-foreground bg-muted/50 rounded-md border border-dashed px-3 py-2 text-center text-xs font-medium">
            ▦ Line items &amp; GST tax table — always here (fixed)
          </div>
          <Zone
            id="belowTable"
            title="Below the table"
            items={containers.belowTable}
            onToggle={toggleHidden}
          />
          <Zone
            id="hidden"
            title="Hidden — won’t print"
            items={containers.hidden}
            onToggle={toggleHidden}
          />
        </div>

        {/* Live preview */}
        <LayoutPreview
          containers={containers}
          primaryColor={primaryColor}
          fontFamily={fontFamily}
          headerText={headerText}
        />
      </div>

      <DragOverlay>
        {activeId ? (
          <div className="bg-background flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs shadow-md">
            <GripVerticalIcon className="size-3.5 opacity-60" aria-hidden />
            {BLOCK_LABELS[activeId]}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/* -------------------------------------------------------------------------- */
/* Zone + chip                                                                */
/* -------------------------------------------------------------------------- */

function Zone({
  id,
  title,
  items,
  onToggle,
}: {
  id: InvoiceLayoutContainer;
  title: string;
  items: InvoiceBlockId[];
  onToggle: (id: InvoiceBlockId) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div>
      <div className="text-muted-foreground mb-1 text-[11px] font-medium tracking-wide uppercase">
        {title}
      </div>
      <SortableContext id={id} items={items} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            'flex min-h-[44px] flex-col gap-1.5 rounded-md border border-dashed p-1.5 transition-colors',
            isOver ? 'border-primary bg-primary/5' : 'border-border',
          )}
        >
          {items.map((bid) => (
            <Chip key={bid} id={bid} hidden={id === 'hidden'} onToggle={onToggle} />
          ))}
          {items.length === 0 ? (
            <span className="text-muted-foreground px-1 py-1 text-[11px]">Drop blocks here</span>
          ) : null}
        </div>
      </SortableContext>
    </div>
  );
}

function Chip({
  id,
  hidden,
  onToggle,
}: {
  id: InvoiceBlockId;
  hidden: boolean;
  onToggle: (id: InvoiceBlockId) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'bg-background flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-xs',
        hidden && 'opacity-70',
      )}
    >
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground cursor-grab touch-none active:cursor-grabbing"
        aria-label={`Drag ${BLOCK_LABELS[id]}`}
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon className="size-3.5" aria-hidden />
      </button>
      <span className="flex-1 truncate">{BLOCK_LABELS[id]}</span>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground"
        aria-label={hidden ? `Show ${BLOCK_LABELS[id]}` : `Hide ${BLOCK_LABELS[id]}`}
        title={hidden ? 'Show on invoice' : 'Hide from invoice'}
        onClick={() => onToggle(id)}
      >
        {hidden ? (
          <EyeOffIcon className="size-3.5" aria-hidden />
        ) : (
          <EyeIcon className="size-3.5" aria-hidden />
        )}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Live preview — a scaled approximation of the invoice                       */
/* -------------------------------------------------------------------------- */

function LayoutPreview({
  containers,
  primaryColor,
  fontFamily,
  headerText,
}: {
  containers: Containers;
  primaryColor: string;
  fontFamily: string;
  headerText: string;
}) {
  const font =
    fontFamily === 'Times-Roman'
      ? 'Georgia, serif'
      : fontFamily === 'Courier'
        ? 'monospace'
        : 'sans-serif';

  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
        Preview
      </div>
      <div
        className="bg-background mx-auto aspect-[1/1.414] w-full overflow-hidden rounded-md border p-2 text-[6px] leading-tight shadow-sm"
        style={{ fontFamily: font }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex w-1/2 flex-col gap-1">
            {containers.headerLeft.map((id) => (
              <PreviewBlock key={id} id={id} primaryColor={primaryColor} headerText={headerText} />
            ))}
          </div>
          <div className="flex w-1/2 flex-col items-end gap-1">
            {containers.headerRight.map((id) => (
              <PreviewBlock
                key={id}
                id={id}
                align="right"
                primaryColor={primaryColor}
                headerText={headerText}
              />
            ))}
          </div>
        </div>
        <div className="my-1.5 h-px" style={{ backgroundColor: primaryColor }} />
        {/* Above table */}
        <div className="flex flex-col gap-1">
          {containers.aboveTable.map((id) => (
            <PreviewBlock key={id} id={id} primaryColor={primaryColor} headerText={headerText} />
          ))}
        </div>
        {/* Fixed table */}
        <div className="text-muted-foreground my-1 rounded-sm border border-dashed p-1 text-center text-[5px]">
          Line items &amp; tax table
        </div>
        {/* Below table */}
        <div className="flex flex-col gap-1">
          {containers.belowTable.map((id) => (
            <PreviewBlock key={id} id={id} primaryColor={primaryColor} headerText={headerText} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PreviewBlock({
  id,
  align = 'left',
  primaryColor,
  headerText,
}: {
  id: InvoiceBlockId;
  align?: 'left' | 'right';
  primaryColor: string;
  headerText: string;
}) {
  if (id === 'logo') {
    return (
      <div
        className="rounded-sm border border-dashed px-1 py-0.5 text-[5px]"
        style={{ color: primaryColor }}
      >
        LOGO
      </div>
    );
  }
  const label = id === 'meta' ? headerText || 'TAX INVOICE' : BLOCK_LABELS[id];
  const emphatic = id === 'meta' || id === 'supplier';
  return (
    <div
      className={cn(
        'bg-muted/60 rounded-sm px-1 py-0.5 text-[5px]',
        align === 'right' ? 'text-right' : 'text-left',
      )}
      style={emphatic ? { color: primaryColor } : undefined}
    >
      {label}
    </div>
  );
}
