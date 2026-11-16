import PDFDocument from 'pdfkit';

/** A4 in points, with a comfortable print margin. */
export const PAGE = {
  width: 595.28,
  height: 841.89,
  margin: 40,
};

export const INK = '#1f2937';
export const MUTED = '#6b7280';
export const RULE = '#d1d5db';
export const HEAD_FILL = '#f3f4f6';

export function newDocument(): typeof PDFDocument.prototype {
  return new PDFDocument({
    size: 'A4',
    margin: PAGE.margin,
    bufferPages: true,
    info: { Producer: 'ERP' },
  });
}

export function bottomOf(doc: PDFKit.PDFDocument): number {
  return doc.page.height - doc.page.margins.bottom;
}

export function contentWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

/** Draws an image into a box without distorting its aspect ratio, swallowing anything PDFKit can't decode. */
export function drawImageInBox(
  doc: PDFKit.PDFDocument,
  image: Buffer | null,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (!image) return;
  try {
    doc.image(image, x, y, { fit: [w, h] });
  } catch {
    // Not a format PDFKit can decode (e.g. the URL served SVG or WebP). Skip it quietly.
  }
}

export interface Column {
  key: string;
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

export interface TableOptions {
  columns: Column[];
  rows: Record<string, string>[];
  startY: number;
  /** Called after addPage() to redraw whatever belongs above the repeated header (title, party blocks, etc). */
  onNewPage?: (doc: PDFKit.PDFDocument) => number;
  rowPadding?: number;
  headFontSize?: number;
  bodyFontSize?: number;
}

/**
 * Draws a line-item table that pages itself: when a page fills up it starts a new page,
 * redraws whatever the caller supplies via onNewPage, and repeats the column header.
 * Returns the y position just below the table, so the caller can place totals under it.
 */
export function drawTable(doc: PDFKit.PDFDocument, options: TableOptions): number {
  const { columns, rows, rowPadding = 6, headFontSize = 9, bodyFontSize = 9 } = options;
  const left = doc.page.margins.left;
  const tableWidth = columns.reduce((sum, c) => sum + c.width, 0);
  let y = options.startY;
  // Each page draws its own frame, from where the table starts on that page.
  let segmentStart = options.startY;

  const drawFrame = (from: number, to: number) => {
    doc
      .rect(left, from, tableWidth, to - from)
      .strokeColor(RULE)
      .lineWidth(0.5)
      .stroke();
    for (let i = 1, x = left; i < columns.length; i += 1) {
      x += columns[i - 1]!.width;
      doc.moveTo(x, from).lineTo(x, to).strokeColor(RULE).lineWidth(0.5).stroke();
    }
  };

  const drawHeader = () => {
    doc.save();
    doc.rect(left, y, tableWidth, 22).fill(HEAD_FILL);
    doc.restore();
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(headFontSize);
    let x = left;
    for (const col of columns) {
      doc.text(col.label, x + 4, y + 6, { width: col.width - 8, align: col.align ?? 'left' });
      x += col.width;
    }
    y += 22;
    doc.font('Helvetica').fontSize(bodyFontSize).fillColor(INK);
  };

  drawHeader();

  for (const row of rows) {
    const heights = columns.map((col) =>
      doc.heightOfString(row[col.key] ?? '', { width: col.width - 8 }),
    );
    const rowHeight = Math.max(...heights, 12) + rowPadding * 2;

    if (y + rowHeight > bottomOf(doc)) {
      drawFrame(segmentStart, y);
      doc.addPage();
      y = options.onNewPage ? options.onNewPage(doc) : doc.page.margins.top;
      segmentStart = y;
      drawHeader();
    }

    let x = left;
    for (const col of columns) {
      doc.text(row[col.key] ?? '', x + 4, y + rowPadding, {
        width: col.width - 8,
        align: col.align ?? 'left',
      });
      x += col.width;
    }
    doc
      .moveTo(left, y + rowHeight)
      .lineTo(left + tableWidth, y + rowHeight)
      .strokeColor(RULE)
      .lineWidth(0.5)
      .stroke();
    y += rowHeight;
  }

  drawFrame(segmentStart, y);

  return y;
}

/** Formats exact paise as "12,34,567.89" (Indian digit grouping). */
export function money(paise: bigint): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const rupees = abs / 100n;
  const cents = abs % 100n;
  const withCommas = indianGrouping(rupees.toString());
  return `${negative ? '-' : ''}${withCommas}.${cents.toString().padStart(2, '0')}`;
}

/** 1234567 -> "12,34,567" (Indian lakh/crore grouping). */
function indianGrouping(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${grouped},${last3}`;
}

export function formatDate(value: string | Date | null): string {
  if (!value) return '-';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '-';
  const day = String(date.getDate()).padStart(2, '0');
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${day} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

export function footer(
  doc: PDFKit.PDFDocument,
  text = 'This is a computer generated document and does not require a signature.',
): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // height + lineBreak:false clip instead of word-wrapping, which keeps PDFKit from
    // treating this as overflow and silently starting a brand new page for it: the one
    // failure mode that would be invisible until someone opened the generated PDF.
    doc
      .font('Helvetica-Oblique')
      .fontSize(7)
      .fillColor(MUTED)
      .text(text, doc.page.margins.left, doc.page.height - 26, {
        width: contentWidth(doc),
        align: 'center',
        height: 14,
        lineBreak: false,
      });
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(MUTED)
      .text(
        `Page ${i - range.start + 1} of ${range.count}`,
        doc.page.margins.left,
        doc.page.height - 26,
        {
          width: contentWidth(doc),
          align: 'right',
          height: 14,
          lineBreak: false,
        },
      );
  }
}
