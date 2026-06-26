'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
import {
  AMOUNT_COL_WIDTH,
  invoiceTableColumns,
  readableTextOn,
  type InvoiceStyle,
  type TableCol,
} from '@/lib/billing/invoice-style';
import type { CompanyPreview } from '@/lib/server/settings/company';

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
  /** Brand tokens + style, for the live preview only. */
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  headerText: string;
  style: InvoiceStyle;
  /** Real (editable) company header details for the preview. */
  company: CompanyPreview;
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
  accentColor,
  fontFamily,
  headerText,
  style,
  company,
}: InvoiceLayoutEditorProps) {
  const [containers, setContainers] = useState<Containers>(() => layoutToContainers(defaultValue));
  const [activeId, setActiveId] = useState<InvoiceBlockId | null>(null);
  // Width of the grabbed card, so the floating overlay matches it and the
  // cursor stays on the card no matter where you grab a (wide) card.
  const [activeWidth, setActiveWidth] = useState<number | null>(null);
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
    setActiveWidth(e.active.rect.current.initial?.width ?? null);
  }

  function handleDragCancel() {
    setActiveId(null);
    setActiveWidth(null);
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
    setActiveWidth(null);
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
      onDragCancel={handleDragCancel}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
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
          accentColor={accentColor}
          fontFamily={fontFamily}
          headerText={headerText}
          style={style}
          company={company}
        />
      </div>

      {/* Portal the drag overlay to <body> so it escapes the Dialog's centering
          transform. A transformed ancestor becomes the containing block for a
          position:fixed overlay, which otherwise offsets the floating card far
          from the cursor (it's rendered inside the translate-x/y-50% dialog). */}
      {typeof document !== 'undefined'
        ? createPortal(
            <DragOverlay>
              {activeId ? (
                <div
                  data-testid="layout-drag-overlay"
                  // Match the grabbed card's width so the cursor stays on it.
                  style={{ width: activeWidth ?? undefined }}
                  className="bg-background ring-primary flex cursor-grabbing items-center gap-1.5 rounded-md border px-1.5 py-1 text-xs shadow-lg ring-1"
                >
                  <GripVerticalIcon
                    className="text-muted-foreground size-3.5 shrink-0"
                    aria-hidden
                  />
                  <span className="flex-1 truncate">{BLOCK_LABELS[activeId]}</span>
                </div>
              ) : null}
            </DragOverlay>,
            document.body,
          )
        : null}
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
  // The WHOLE card is the drag handle — grab it anywhere. The eye button stops
  // pointer propagation so a click toggles instead of starting a drag.
  return (
    <div
      ref={setNodeRef}
      data-block={id}
      style={style}
      className={cn(
        'bg-background flex cursor-grab touch-none items-center gap-1.5 rounded-md border px-1.5 py-1 text-xs select-none active:cursor-grabbing',
        hidden && 'opacity-70',
      )}
      {...attributes}
      {...listeners}
    >
      <GripVerticalIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      <span className="flex-1 truncate">{BLOCK_LABELS[id]}</span>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground"
        aria-label={hidden ? `Show ${BLOCK_LABELS[id]}` : `Hide ${BLOCK_LABELS[id]}`}
        title={hidden ? 'Show on invoice' : 'Hide from invoice'}
        onPointerDown={(e) => e.stopPropagation()}
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
/* Live preview — a realistic, proportionally-scaled mini-invoice so the user  */
/* sees how much space each block actually takes.                              */
/* -------------------------------------------------------------------------- */

const MUTED = '#6b7280';

// Representative content so block heights reflect the real invoice footprint.
const MOCK = {
  company: 'Apar Creative LLP',
  companyLines: [
    '4th Floor, Trade House, Lower Parel, Mumbai 400013',
    'GSTIN 27ABCDE1234F1Z5',
    'PAN ABCDE1234F',
  ],
  metaLines: [
    'Invoice: INV/2026-27/0007',
    'Date: 26 Jun 2026',
    'Due by: 26 Jul 2026',
    'Place of supply: Maharashtra',
  ],
  client: 'Lodha Group',
  clientLines: [
    'One Lodha Place, Lower Parel',
    'Mumbai, Maharashtra 400013',
    'GSTIN 27LODHA1234A1Z3',
  ],
  amountWords: 'Rupees Seven Lakh Nineteen Thousand Eight Hundred Only',
  terms: 'Net 30. Interest @ 18% p.a. on balances overdue beyond the due date.',
  notes: 'Thank you for partnering with Apar Creative.',
  payment: [
    ['Beneficiary', 'Apar Creative LLP'],
    ['Bank', 'HDFC Bank'],
    ['A/c No.', '50200012345678'],
    ['IFSC', 'HDFC0000123'],
  ] as const,
  items: [
    {
      sr: '1',
      desc: 'Brand identity refresh — Phase 1',
      hsn: '9983',
      qty: '1',
      rate: '2,50,000.00',
      tax: '18%',
      amount: '2,50,000.00',
    },
    {
      sr: '2',
      desc: 'Festive campaign films (3 × 30s)',
      hsn: '9983',
      qty: '3',
      rate: '1,20,000.00',
      tax: '18%',
      amount: '3,60,000.00',
    },
  ] as const,
  summary: [
    ['Sub Total', '6,10,000.00'],
    ['CGST @ 9%', '54,900.00'],
    ['SGST @ 9%', '54,900.00'],
  ] as const,
  total: '7,19,800.00',
};

function LayoutPreview({
  containers,
  primaryColor,
  accentColor,
  fontFamily,
  headerText,
  style,
  company,
}: {
  containers: Containers;
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  headerText: string;
  style: InvoiceStyle;
  company: CompanyPreview;
}) {
  const font =
    fontFamily === 'Times-Roman'
      ? 'Georgia, serif'
      : fontFamily === 'Courier'
        ? 'monospace'
        : 'sans-serif';
  const pad = style.density === 'relaxed' ? 16 : style.density === 'compact' ? 8 : 12;
  const gap = style.density === 'relaxed' ? 11 : style.density === 'compact' ? 5 : 8;
  const ctx = { primaryColor, accentColor, headerText, style, company };

  return (
    <div className="space-y-1 lg:sticky lg:top-0">
      <div className="text-muted-foreground flex items-baseline gap-1.5 text-[11px] font-medium tracking-wide uppercase">
        Preview
        <span className="text-[10px] normal-case opacity-70">live · approximate spacing</span>
      </div>
      <div
        className="mx-auto aspect-[1/1.414] w-full max-w-[380px] overflow-hidden rounded-md border bg-white leading-snug text-black shadow-sm"
        style={{ fontFamily: font, padding: pad }}
      >
        {/* Header — two columns */}
        <div className="flex items-start justify-between" style={{ gap }}>
          <div className="flex flex-col" style={{ width: '56%', gap: gap * 0.6 }}>
            {containers.headerLeft.map((id) => (
              <PreviewBlock key={id} id={id} {...ctx} />
            ))}
          </div>
          <div className="flex flex-col items-end" style={{ width: '42%', gap: gap * 0.6 }}>
            {containers.headerRight.map((id) => (
              <PreviewBlock key={id} id={id} align="right" {...ctx} />
            ))}
          </div>
        </div>
        <div
          className="h-px"
          style={{ backgroundColor: primaryColor, marginTop: gap, marginBottom: gap }}
        />
        {/* Above the table */}
        <div className="flex flex-col" style={{ gap }}>
          {containers.aboveTable.map((id) => (
            <PreviewBlock key={id} id={id} {...ctx} />
          ))}
        </div>
        {/* Fixed line-items + tax table */}
        <div style={{ marginTop: gap, marginBottom: gap }}>
          <PreviewTable {...ctx} />
        </div>
        {/* Below the table */}
        <div className="flex flex-col" style={{ gap }}>
          {containers.belowTable.map((id) => (
            <PreviewBlock key={id} id={id} {...ctx} />
          ))}
        </div>
      </div>
    </div>
  );
}

type Ctx = {
  primaryColor: string;
  accentColor: string;
  headerText: string;
  style: InvoiceStyle;
  company: CompanyPreview;
};

/** Heading colour respecting the per-element override + the colorHeadings flag. */
function headingColorOf(style: InvoiceStyle, primaryColor: string): string {
  return style.colors.heading ?? (style.colorHeadings ? primaryColor : '#111111');
}

/** A small label/value line used inside several blocks. */
function Line({ children, size, color }: { children: ReactNode; size: number; color?: string }) {
  return (
    <div style={{ fontSize: size, color }} className="truncate">
      {children}
    </div>
  );
}

function PreviewBlock({
  id,
  align = 'left',
  ...ctx
}: { id: InvoiceBlockId; align?: 'left' | 'right' } & Ctx) {
  const { primaryColor, accentColor, headerText, style, company } = ctx;
  const fs = style.fontScale;
  const body = 6.8 * fs;
  const muted = 6 * fs;
  const name = 9 * fs;
  const headingColor = headingColorOf(style, primaryColor);
  const titleColor = style.colors.title ?? primaryColor;
  const right = align === 'right';

  switch (id) {
    case 'logo': {
      const h = style.logoSize === 'sm' ? 14 : style.logoSize === 'lg' ? 30 : 20;
      const w = style.logoSize === 'sm' ? 50 : style.logoSize === 'lg' ? 92 : 70;
      const self =
        style.logoAlign === 'center'
          ? 'mx-auto'
          : style.logoAlign === 'right'
            ? 'ml-auto'
            : 'mr-auto';
      return (
        <div
          className={cn('flex items-center justify-center rounded-sm border border-dashed', self)}
          style={{
            color: primaryColor,
            borderColor: primaryColor,
            height: h,
            width: w,
            fontSize: 5 * fs,
          }}
        >
          LOGO
        </div>
      );
    }
    case 'supplier': {
      const lines = [
        company.address,
        company.gstin ? `GSTIN ${company.gstin}` : null,
        company.pan ? `PAN ${company.pan}` : null,
      ].filter((l): l is string => !!l && l.length > 0);
      return (
        <div className={right ? 'text-right' : 'text-left'}>
          <div style={{ fontSize: name, fontWeight: 700 }} className="truncate">
            {company.name || 'Your Company'}
          </div>
          {lines.map((l, i) => (
            <Line key={i} size={muted} color={MUTED}>
              {l}
            </Line>
          ))}
        </div>
      );
    }
    case 'meta':
      return (
        <div className={right ? 'text-right' : 'text-left'}>
          {style.accentHeaderBand ? (
            <div className={cn('mb-0.5 flex', right ? 'justify-end' : 'justify-start')}>
              <span
                className="rounded-sm px-1.5 py-0.5 font-bold"
                style={{ backgroundColor: accentColor, color: titleColor, fontSize: 9.5 * fs }}
              >
                {headerText || 'TAX INVOICE'}
              </span>
            </div>
          ) : (
            <div
              style={{ fontSize: 9.5 * fs, fontWeight: 700, color: titleColor }}
              className="truncate"
            >
              {headerText || 'TAX INVOICE'}
            </div>
          )}
          {MOCK.metaLines.map((l, i) => (
            <Line key={i} size={body}>
              {l}
            </Line>
          ))}
        </div>
      );
    case 'billTo':
      return (
        <div className={right ? 'text-right' : 'text-left'}>
          <Line size={muted} color={MUTED}>
            Billed To,
          </Line>
          <div style={{ fontSize: name * 0.95, fontWeight: 700 }} className="truncate">
            {MOCK.client}
          </div>
          {MOCK.clientLines.map((l, i) => (
            <Line key={i} size={body}>
              {l}
            </Line>
          ))}
        </div>
      );
    case 'amountWords':
      return (
        <div style={{ fontSize: body, fontStyle: 'italic' }} className="truncate">
          {MOCK.amountWords}
        </div>
      );
    case 'terms':
      return (
        <div>
          <div style={{ fontSize: body, fontWeight: 700, color: headingColor }}>Terms</div>
          <div style={{ fontSize: body }}>{MOCK.terms}</div>
        </div>
      );
    case 'notes':
      return (
        <div>
          <div style={{ fontSize: body, fontWeight: 700, color: headingColor }}>Notes</div>
          <div style={{ fontSize: body }}>{MOCK.notes}</div>
        </div>
      );
    case 'payment':
      return (
        <div className="rounded-sm border" style={{ borderColor: '#d1d5db', padding: 5 }}>
          <div style={{ fontSize: body, fontWeight: 700, color: headingColor }} className="mb-0.5">
            Payment details
          </div>
          {MOCK.payment.map(([k, v]) => (
            <div key={k} className="flex gap-2" style={{ fontSize: muted }}>
              <span style={{ width: '34%', color: MUTED }}>{k}</span>
              <span className="flex-1 truncate">{v}</span>
            </div>
          ))}
        </div>
      );
    case 'paymentLink':
      return (
        <div className="rounded-sm" style={{ backgroundColor: '#eff6ff', padding: 4 }}>
          <div style={{ fontSize: body, fontWeight: 700, color: headingColor }}>Pay online</div>
          <Line size={muted} color="#2563eb">
            https://rzp.io/i/sample-link
          </Line>
        </div>
      );
    case 'signatory':
      return (
        <div className="ml-auto text-right" style={{ width: '48%' }}>
          <div style={{ fontSize: body, fontWeight: 700, color: headingColor }}>
            For {company.name || 'Your Company'}
          </div>
          <div style={{ height: 16 * fs }} />
          <Line size={body}>Authorised Signatory</Line>
        </div>
      );
    default:
      return null;
  }
}

/** One bordered table cell for the preview. Hoisted (not defined in render). */
function Cell({
  children,
  w,
  size,
  border,
  right,
  st,
}: {
  children: ReactNode;
  w: string;
  size: number;
  border: string;
  right?: boolean;
  st?: CSSProperties;
}) {
  return (
    <div
      style={{
        width: w,
        fontSize: size,
        borderRight: `0.5px solid ${border}`,
        borderBottom: `0.5px solid ${border}`,
        padding: '2px 3px',
        ...st,
      }}
      className={cn('truncate', right && 'text-right')}
    >
      {children}
    </div>
  );
}

const ITEM_FIELD: Record<TableCol['key'], keyof (typeof MOCK.items)[number]> = {
  srNo: 'sr',
  description: 'desc',
  hsn: 'hsn',
  qty: 'qty',
  rate: 'rate',
  taxPct: 'tax',
  amount: 'amount',
};

/** The GST line-items + tax-summary table — columns + colours driven by style. */
function PreviewTable({ accentColor, style }: Ctx) {
  const cell = 6 * style.fontScale;
  const border = '#9ca3af';
  const cols = invoiceTableColumns(style);
  const labelW = `${100 - AMOUNT_COL_WIDTH}%`;
  const amtW = `${AMOUNT_COL_WIDTH}%`;

  const hb = style.colors.tableHeaderBg ?? accentColor;
  const ht = style.colors.tableHeaderText ?? readableTextOn(hb);
  const tb = style.colors.totalBg ?? accentColor;
  const tt = style.colors.totalText ?? readableTextOn(tb);
  const head: CSSProperties = { backgroundColor: hb, color: ht, fontWeight: 700 };
  const totalStyle: CSSProperties = style.emphasizeTotal
    ? { backgroundColor: tb, color: tt, fontWeight: 700 }
    : { fontWeight: 700 };

  return (
    <div style={{ borderTop: `0.5px solid ${border}`, borderLeft: `0.5px solid ${border}` }}>
      <div className="flex">
        {cols.map((c) => (
          <Cell
            key={c.key}
            w={`${c.width}%`}
            size={cell}
            border={border}
            right={c.align === 'right'}
            st={head}
          >
            {c.key === 'amount' ? 'Amount (INR)' : c.label}
          </Cell>
        ))}
      </div>
      {MOCK.items.map((it) => (
        <div className="flex" key={it.sr}>
          {cols.map((c) => (
            <Cell
              key={c.key}
              w={`${c.width}%`}
              size={cell}
              border={border}
              right={c.align === 'right'}
            >
              {it[ITEM_FIELD[c.key]]}
            </Cell>
          ))}
        </div>
      ))}
      {MOCK.summary.map(([k, v]) => (
        <div className="flex" key={k}>
          <Cell w={labelW} size={cell} border={border} right st={{ fontWeight: 700 }}>
            {k}
          </Cell>
          <Cell w={amtW} size={cell} border={border} right>
            {v}
          </Cell>
        </div>
      ))}
      <div className="flex">
        <Cell w={labelW} size={cell} border={border} right st={totalStyle}>
          TOTAL
        </Cell>
        <Cell w={amtW} size={cell} border={border} right st={totalStyle}>
          {MOCK.total}
        </Cell>
      </div>
    </div>
  );
}
