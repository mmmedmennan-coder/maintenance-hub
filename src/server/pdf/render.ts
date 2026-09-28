import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
import { formatMoney, formatQuantity, formatRate } from "@/lib/money";
import { t, te } from "@/lib/i18n";
import { formatCalendarDate, formatDateTime } from "@/lib/time";

const FONT_DIR = path.resolve(process.cwd(), "assets/fonts");
const NAVY = "#13233F";
const MUTED = "#5E6B7F";
const TEAL = "#0E7C73";

type Doc = InstanceType<typeof PDFDocument>;

function createDoc(title: string, appName: string) {
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: title, Author: appName, Creator: appName } });
  doc.registerFont("body", path.join(FONT_DIR, "DejaVuSans.ttf"));
  doc.registerFont("bold", path.join(FONT_DIR, "DejaVuSans-Bold.ttf"));
  doc.font("body");
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  return { doc, done };
}

/** Customer-entered content is rendered as plain text only (no HTML, no external resources). */
function text(value: string | null | undefined) {
  return (value ?? "—").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function header(doc: Doc, appName: string, title: string, reference: string) {
  doc.fillColor(TEAL).font("bold").fontSize(10).text(appName.toUpperCase(), { characterSpacing: 1 });
  doc.moveDown(0.3);
  doc.fillColor(NAVY).font("bold").fontSize(20).text(title);
  doc.fillColor(MUTED).font("body").fontSize(10).text(reference);
  doc.moveDown(0.8);
}

function section(doc: Doc, label: string) {
  doc.moveDown(0.6);
  doc.fillColor(TEAL).font("bold").fontSize(11).text(label.toUpperCase(), { characterSpacing: 0.5 });
  doc.moveDown(0.2);
  doc.fillColor(NAVY).font("body").fontSize(10);
}

function field(doc: Doc, label: string, value: string | null | undefined) {
  doc.font("bold").fillColor(MUTED).fontSize(9).text(label);
  doc.font("body").fillColor(NAVY).fontSize(10).text(text(value));
  doc.moveDown(0.3);
}

function footer(doc: Doc, note: string) {
  doc.moveDown(1.2);
  doc.fillColor(MUTED).font("body").fontSize(8).text(note);
}

export type ReportPdfData = {
  appName: string;
  workOrderReference: string;
  bookingReference: string;
  customerName: string;
  providerName: string;
  siteName: string;
  siteCity: string;
  equipment: string;
  technicianName: string | null;
  scheduledStart: Date | null;
  submittedAt: Date;
  submittedByName: string;
  findings: string;
  workPerformed: string;
  partsUsed: string | null;
  recommendations: string | null;
  nextServiceDate: Date | null;
  repairDeclined: boolean;
  approvedScopes: { title: string; versionNo: number; totalMinor: number; currency: string; decidedAt: Date; snapshotHash: string }[];
  /** JPEG data only (see generateReportPdf); other formats are listed by name. */
  photos: { name: string; data: Buffer | null }[];
  snapshotHash: string;
};

export async function renderReportPdf(d: ReportPdfData): Promise<Buffer> {
  const { doc, done } = createDoc(`${t("pdf.report.title")} ${d.workOrderReference}`, d.appName);
  header(doc, d.appName, t("pdf.report.title"), `${d.workOrderReference} · ${d.bookingReference}`);
  section(doc, t("pdf.parties"));
  field(doc, t("pdf.customer"), d.customerName);
  field(doc, t("pdf.provider"), d.providerName);
  field(doc, t("pdf.site"), `${d.siteName} — ${d.siteCity}`);
  field(doc, t("pdf.equipment"), d.equipment);
  field(doc, t("pdf.technician"), d.technicianName);
  field(doc, t("pdf.visit"), formatDateTime(d.scheduledStart));
  section(doc, t("pdf.report.content"));
  field(doc, t("pdf.report.findings"), d.findings);
  field(doc, t("pdf.report.work"), d.workPerformed);
  field(doc, t("pdf.report.parts"), d.partsUsed);
  field(doc, t("pdf.report.recommendations"), d.recommendations);
  field(doc, t("pdf.report.nextService"), d.nextServiceDate ? formatCalendarDate(d.nextServiceDate) : t("pdf.report.noNextService"));
  section(doc, t("pdf.report.scope"));
  if (d.approvedScopes.length === 0) {
    doc.text(d.repairDeclined ? t("pdf.report.repairDeclined") : t("pdf.report.noRepair"));
  }
  for (const s of d.approvedScopes) {
    doc.text(`${s.title} — v${s.versionNo} — ${formatMoney(s.totalMinor, s.currency)} — ${t("pdf.report.approvedOn")} ${formatDateTime(s.decidedAt)}`);
    doc.fillColor(MUTED).fontSize(7).text(`SHA-256 ${s.snapshotHash}`).fillColor(NAVY).fontSize(10);
  }
  if (d.photos.length) {
    section(doc, t("pdf.report.photos"));
    for (const p of d.photos) {
      if (p.data) {
        try {
          if (doc.y > 560) doc.addPage();
          doc.image(p.data, { fit: [240, 180] });
          doc.fillColor(MUTED).fontSize(8).text(text(p.name)).fillColor(NAVY).fontSize(10);
          doc.moveDown(0.5);
          continue;
        } catch {
          // fall through to listing the file name
        }
      }
      doc.text(`• ${text(p.name)}`);
    }
  }
  section(doc, t("pdf.integrity"));
  doc.text(`${t("pdf.report.submittedBy")} ${d.submittedByName} — ${formatDateTime(d.submittedAt)}`);
  doc.fillColor(MUTED).fontSize(7).text(`SHA-256 ${d.snapshotHash}`);
  footer(doc, t("pdf.report.disclaimer"));
  doc.end();
  return done;
}

export type QuotePdfData = {
  appName: string;
  title: string;
  workOrderReference: string;
  versionNo: number;
  customerName: string;
  providerName: string;
  equipment: string;
  scopeSummary: string;
  estimatedDuration: string | null;
  timingNote: string | null;
  exclusions: string | null;
  warrantyTerms: string | null;
  validUntil: Date | null;
  issuedAt: Date;
  currency: string;
  lines: { kind: string; description: string; quantityMilli: number; unitPriceMinor: number; taxRateBp: number; totalMinor: number }[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  snapshotHash: string;
};

export async function renderQuotePdf(d: QuotePdfData): Promise<Buffer> {
  const { doc, done } = createDoc(`${d.title} ${d.workOrderReference} v${d.versionNo}`, d.appName);
  header(doc, d.appName, d.title, `${d.workOrderReference} · ${t("pdf.quote.version")} ${d.versionNo} · ${t("pdf.quote.issuedOn")} ${formatDateTime(d.issuedAt)}`);
  section(doc, t("pdf.parties"));
  field(doc, t("pdf.customer"), d.customerName);
  field(doc, t("pdf.provider"), d.providerName);
  field(doc, t("pdf.equipment"), d.equipment);
  section(doc, t("pdf.quote.scope"));
  doc.text(text(d.scopeSummary));
  section(doc, t("pdf.quote.lines"));
  for (const l of d.lines) {
    doc.font("bold").text(`${te("enums.lineKind", l.kind)} — ${text(l.description)}`);
    doc
      .font("body")
      .fillColor(MUTED)
      .text(`${formatQuantity(l.quantityMilli)} × ${formatMoney(l.unitPriceMinor, d.currency)} · ${t("pdf.quote.tax")} ${formatRate(l.taxRateBp)} · ${formatMoney(l.totalMinor, d.currency)}`)
      .fillColor(NAVY);
    doc.moveDown(0.2);
  }
  doc.moveDown(0.4);
  doc.text(`${t("pdf.quote.subtotal")} : ${formatMoney(d.subtotalMinor, d.currency)}`);
  doc.text(`${t("pdf.quote.taxTotal")} : ${formatMoney(d.taxMinor, d.currency)}`);
  doc.font("bold").text(`${t("pdf.quote.total")} : ${formatMoney(d.totalMinor, d.currency)}`).font("body");
  section(doc, t("pdf.quote.terms"));
  field(doc, t("pdf.quote.duration"), d.estimatedDuration);
  field(doc, t("pdf.quote.timing"), d.timingNote);
  field(doc, t("pdf.quote.exclusions"), d.exclusions);
  field(doc, t("pdf.quote.warranty"), d.warrantyTerms);
  field(doc, t("pdf.quote.validUntil"), d.validUntil ? formatDateTime(d.validUntil) : null);
  section(doc, t("pdf.integrity"));
  doc.fillColor(MUTED).fontSize(7).text(`SHA-256 ${d.snapshotHash}`);
  footer(doc, t("pdf.quote.disclaimer"));
  doc.end();
  return done;
}
