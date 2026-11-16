import { amountInWords, sameGstState, splitTax } from '@erp/shared';
import {
  RULE,
  INK,
  MUTED,
  bottomOf,
  contentWidth,
  drawImageInBox,
  drawTable,
  footer,
  money,
  newDocument,
  type Column,
} from './layout';
import type { InvoiceDocumentData, PartyBlock, PurchaseOrderDocumentData } from './document-data';

type Data = InvoiceDocumentData | PurchaseOrderDocumentData;

function drawPartyLines(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  heading: string,
  party: PartyBlock,
): number {
  doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text(heading, x, y, { width });
  let cursor = y + 13;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(party.name, x, cursor, { width });
  cursor += doc.heightOfString(party.name, { width }) + 2;
  doc.font('Helvetica').fontSize(9).fillColor(INK);
  for (const line of party.lines) {
    doc.text(line, x, cursor, { width });
    cursor += doc.heightOfString(line, { width }) + 1;
  }
  if (party.gstin) {
    doc.text(`GSTIN: ${party.gstin}`, x, cursor, { width });
    cursor += 12;
  }
  if (party.state) {
    doc.text(`State: ${party.state}`, x, cursor, { width });
    cursor += 12;
  }
  return cursor;
}

/** Draws the logo/title/From block and the document number/date line. Returns the y below it. */
function drawHeader(doc: PDFKit.PDFDocument, data: Data): number {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const top = doc.page.margins.top;

  drawImageInBox(doc, data.org.logo, left, top, 64, 64);

  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(data.title, left, top, {
    width,
    align: 'center',
  });

  const fromWidth = 220;
  const fromX = left + width - fromWidth;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('From:', fromX, top, {
    width: fromWidth,
    align: 'right',
  });
  let fromY = top + 13;
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(INK)
    .text(data.org.name, fromX, fromY, { width: fromWidth, align: 'right' });
  fromY += doc.heightOfString(data.org.name, { width: fromWidth }) + 2;
  doc.font('Helvetica').fontSize(8.5).fillColor(INK);
  for (const line of data.org.lines) {
    doc.text(line, fromX, fromY, { width: fromWidth, align: 'right' });
    fromY += doc.heightOfString(line, { width: fromWidth, align: 'right' }) + 1;
  }
  if (data.org.gstin) {
    doc.text(`GSTIN: ${data.org.gstin}`, fromX, fromY, { width: fromWidth, align: 'right' });
    fromY += 11;
  }

  const belowLogoY = top + 70;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK);
  doc.text(`No: ${data.number}`, left, belowLogoY, { width: 220 });
  doc.font('Helvetica').fontSize(9);
  doc.text(`Date: ${data.date}`, left, belowLogoY + 13, { width: 220 });
  if (data.secondDate) {
    doc.text(`${data.secondDate.label}: ${data.secondDate.value}`, left, belowLogoY + 26, {
      width: 220,
    });
  }

  const y = Math.max(belowLogoY + 40, fromY + 8);
  doc
    .moveTo(left, y)
    .lineTo(left + width, y)
    .strokeColor(RULE)
    .lineWidth(0.75)
    .stroke();
  return y + 10;
}

const COLUMNS: Column[] = [
  { key: 'no', label: '#', width: 20, align: 'right' },
  { key: 'name', label: 'Item', width: 120 },
  { key: 'hsn', label: 'HSN', width: 42 },
  { key: 'qty', label: 'Qty', width: 56, align: 'right' },
  { key: 'rate', label: 'Rate', width: 55, align: 'right' },
  { key: 'taxable', label: 'Taxable', width: 60, align: 'right' },
  { key: 'gst', label: 'GST%', width: 38, align: 'right' },
  { key: 'tax', label: 'Tax', width: 56, align: 'right' },
  { key: 'total', label: 'Total', width: 68, align: 'right' },
];

export function renderLineItemDocument(data: Data): PDFKit.PDFDocument {
  const doc = newDocument();
  const left = doc.page.margins.left;
  const width = contentWidth(doc);

  let y = drawHeader(doc, data);

  const partyWidth = 'shipTo' in data && data.shipTo ? width / 2 - 10 : width;
  const partyBottom = drawPartyLines(doc, left, y, partyWidth, 'Bill To:', data.party);
  let afterParty = partyBottom;
  if ('shipTo' in data && data.shipTo) {
    const shipBottom = drawPartyLines(
      doc,
      left + width / 2 + 10,
      y,
      width / 2 - 10,
      'Ship To:',
      data.shipTo,
    );
    afterParty = Math.max(afterParty, shipBottom);
  }
  y = afterParty + 12;

  const rows = data.lines.map((line, i) => ({
    no: String(i + 1),
    name: line.name,
    hsn: line.hsn ?? '-',
    qty: `${line.quantity} ${line.unit}`,
    rate: money(line.unitPrice),
    taxable: money(line.subtotal),
    gst: `${line.gstRate}%`,
    tax: money(line.taxAmount),
    total: money(line.total),
  }));

  y = drawTable(doc, {
    columns: COLUMNS,
    rows,
    startY: y,
    onNewPage: (d) => {
      d.font('Helvetica')
        .fontSize(8)
        .fillColor(MUTED)
        .text(`${data.title} ${data.number} (contd.)`, left, d.page.margins.top, { width });
      return d.page.margins.top + 16;
    },
  });
  y += 14;

  // Totals block, right aligned. GST is split into CGST+SGST (same state) or IGST
  // (inter-state) at the overall-invoice level, not per HSN/rate group.
  const sameState = sameGstState(data.org, data.party);
  const split = splitTax(sameState, data.taxTotal);
  const boxWidth = 260;
  const boxX = left + width - boxWidth;
  if (y > bottomOf(doc) - 140) {
    doc.addPage();
    y = doc.page.margins.top;
  }

  const line = (label: string, value: string, bold = false) => {
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9.5)
      .fillColor(INK);
    doc.text(label, boxX, y, { width: boxWidth - 90 });
    doc.text(value, boxX + boxWidth - 90, y, { width: 90, align: 'right' });
    y += 14;
  };
  line('Subtotal', money(data.subtotal));
  if (sameState) {
    line('CGST', money(split.cgst));
    line('SGST', money(split.sgst));
  } else {
    line('IGST', money(split.igst));
  }
  doc
    .moveTo(boxX, y)
    .lineTo(boxX + boxWidth, y)
    .strokeColor(RULE)
    .stroke();
  y += 4;
  line('Grand Total', money(data.grandTotal), true);
  y += 6;

  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  doc.text('Amount in words:', left, y, { width });
  y += 12;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK);
  doc.text(amountInWords(data.grandTotal), left, y, { width });
  y += doc.heightOfString(amountInWords(data.grandTotal), { width }) + 14;

  if (data.org.bankDetails) {
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text('Bank details:', left, y, { width: width / 2 });
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(INK)
      .text(data.org.bankDetails, left, y + 12, {
        width: width / 2 - 10,
      });
  }

  const signX = left + width - 200;
  doc.font('Helvetica').fontSize(9).fillColor(INK).text(`For ${data.org.name}`, signX, y, {
    width: 200,
    align: 'center',
  });
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(MUTED)
    .text('Authorised Signatory', signX, y + 46, { width: 200, align: 'center' });

  if (data.notes) {
    const notesY = y + 70;
    doc
      .font('Helvetica-Oblique')
      .fontSize(8)
      .fillColor(MUTED)
      .text(`Notes: ${data.notes}`, left, notesY, {
        width,
      });
  }

  footer(doc);
  return doc;
}
