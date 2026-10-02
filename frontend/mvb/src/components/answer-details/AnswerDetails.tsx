import { useRef } from "react";
import "./AnswerDetails.css";

export type InformationCard = {
  id: string;
  title: string;
  description?: string | null;
  badge?: string | null;
  facts: { label: string; value: string }[];
  progress?: number;
};
type InvoiceItem = {
  name: string;
  category: string;
  periodStart?: string;
  periodEnd?: string;
  quantity?: number;
  amountBeforeTax?: number;
  amountIncludingTax?: number;
};
export type Invoice = {
  id: string;
  month: string;
  periodStart?: string;
  periodEnd?: string;
  date?: string;
  dueDate?: string;
  paidAt?: string | null;
  reference?: string;
  customerNumber?: string;
  status?: string;
  currency: string;
  items: InvoiceItem[];
  subtotal?: number;
  discounts?: number;
  previousBalance?: number;
  total?: number;
};
export type AnswerPresentation = {
  title: string;
  source: "user" | "website";
  cards: InformationCard[];
  invoices: Invoice[];
};

const dateText = (value?: string | null) => {
  if (!value) return "—";
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return parts ? `${parts[3]}.${parts[2]}.${parts[1]}` : value;
};
const money = (value: number | undefined, currency: string) => value == null ? "—"
  : new Intl.NumberFormat("he-IL", { style: "currency", currency }).format(value);
const paymentLabels: Record<string, string> = { paid: "שולם", unpaid: "ממתין לתשלום", pending: "ממתין לתשלום", overdue: "מועד התשלום עבר" };
const statusText = (status?: string) => paymentLabels[status || ""] || status;
const periodText = (start?: string, end?: string) => start && end ? `${dateText(start)} – ${dateText(end)}` : "—";

function InvoiceStatement({ invoice }: { invoice: Invoice }) {
  const paper = useRef<HTMLElement>(null);
  const groups = [
    { id: "recurring", title: "חיובים קבועים" },
    { id: "oneTime", title: "חיובים חד־פעמיים" },
    { id: "credit", title: "זיכויים והנחות" },
    { id: "other", title: "חיובים נוספים" },
  ];
  const print = () => {
    const element = paper.current;
    if (!element) return;
    element.classList.add("invoice-print-target");
    document.body.classList.add("printing-invoice");
    try { window.print(); } finally {
      document.body.classList.remove("printing-invoice");
      element.classList.remove("invoice-print-target");
    }
  };

  return (
    <section className="invoice-preview" aria-label={`חשבון ${invoice.month}`}>
      <div className="invoice-toolbar" dir="rtl">
        <div><span className="document-icon" aria-hidden="true">▤</span><strong>החשבון שלך</strong><span className="invoice-month">{invoice.month}</span></div>
        <button type="button" onClick={print}>הדפסה / שמירה כ־PDF <span aria-hidden="true">↗</span></button>
      </div>
      <article ref={paper} className="invoice-statement" dir="rtl">
        <header className="statement-header">
          <div><span className="statement-eyebrow">NOVA TV · החשבון שלך</span><h3>פירוט חשבון</h3><p>{invoice.month}</p></div>
          <div className="statement-logo" dir="ltr">N<span>O</span>VA<small>TV</small></div>
        </header>
        <dl className="statement-meta">
          {[
            ["מספר חשבון", invoice.reference || invoice.id],
            ["מספר לקוח", invoice.customerNumber],
            ["תקופת החשבון", periodText(invoice.periodStart, invoice.periodEnd)],
            ["תאריך הפקה", dateText(invoice.date)],
            ["מועד לתשלום", dateText(invoice.dueDate)],
            ...(invoice.paidAt ? [["שולם בתאריך", dateText(invoice.paidAt)]] : []),
          ].map(([label, value]) => value && <div key={label}><dt>{label}</dt><dd><bdi>{value}</bdi></dd></div>)}
        </dl>
        <div className="statement-amount">
          <div><span>סכום החשבון</span><strong><bdi>{money(invoice.total, invoice.currency)}</bdi></strong></div>
          {invoice.status && <span className={`payment-status ${invoice.status === "paid" || invoice.status === "שולם" ? "is-paid" : ""}`}>{statusText(invoice.status)}</span>}
        </div>
        <h4 className="statement-section-title">פירוט החיובים והזיכויים</h4>
        <div className="statement-table-scroll" tabIndex={0} role="region" aria-label="פירוט חיובים — ניתן לגלול בטלפון">
          <table className="statement-table">
            <thead><tr><th scope="col">תיאור החיוב</th><th scope="col">תקופת החיוב</th><th scope="col">כמות</th><th scope="col">לפני מע״מ</th><th scope="col">כולל מע״מ</th></tr></thead>
            <tbody>
              {groups.map(group => {
                const items = invoice.items.filter(item => group.id === "other" ? !["recurring", "oneTime", "credit"].includes(item.category) : item.category === group.id);
                if (!items.length) return null;
                const net = items.every(item => item.amountBeforeTax != null) ? items.reduce((sum, item) => sum + item.amountBeforeTax!, 0) : undefined;
                const gross = items.every(item => item.amountIncludingTax != null) ? items.reduce((sum, item) => sum + item.amountIncludingTax!, 0) : undefined;
                return <GroupRows key={group.id} title={group.title} items={items} net={net} gross={gross} currency={invoice.currency} />;
              })}
            </tbody>
          </table>
        </div>
        <dl className="statement-totals">
          {invoice.subtotal != null && <div><dt>חיובים לפני הנחות</dt><dd><bdi>{money(invoice.subtotal, invoice.currency)}</bdi></dd></div>}
          {invoice.discounts != null && <div><dt>הנחות וזיכויים</dt><dd><bdi>{money(-Math.abs(invoice.discounts), invoice.currency)}</bdi></dd></div>}
          {invoice.previousBalance != null && <div><dt>יתרה מחשבון קודם</dt><dd><bdi>{money(invoice.previousBalance, invoice.currency)}</bdi></dd></div>}
          <div className="statement-grand-total"><dt>סה״כ לתשלום</dt><dd><bdi>{money(invoice.total, invoice.currency)}</bdi></dd></div>
        </dl>
        <footer className="statement-footer"><span>תודה שבחרת NOVA TV</span><span>הנתונים מתוך חשבון ההדגמה שלך.</span></footer>
      </article>
    </section>
  );
}

function GroupRows({ title, items, net, gross, currency }: { title: string; items: InvoiceItem[]; net?: number; gross?: number; currency: string }) {
  return <>
    <tr className="charge-group"><th scope="rowgroup" colSpan={5}>{title}</th></tr>
    {items.map((item, index) => <tr key={`${item.name}-${index}`}>
      <th scope="row">{item.name}</th><td><bdi>{periodText(item.periodStart, item.periodEnd)}</bdi></td><td>{item.quantity ?? "—"}</td>
      <td><bdi>{money(item.amountBeforeTax, currency)}</bdi></td><td><bdi>{money(item.amountIncludingTax, currency)}</bdi></td>
    </tr>)}
    <tr className="charge-subtotal"><th scope="row" colSpan={3}>סה״כ {title}</th><td><bdi>{money(net, currency)}</bdi></td><td><bdi>{money(gross, currency)}</bdi></td></tr>
  </>;
}

export default function AnswerDetails({ presentation }: { presentation?: AnswerPresentation | null }) {
  if (!presentation || (!presentation.cards.length && !presentation.invoices.length)) return null;
  return <div className="answer-details" dir="rtl">
    <div className="details-heading"><h3>{presentation.title}</h3><span>{presentation.source === "user" ? "מהחשבון שלך" : "מאתר NOVA TV"}</span></div>
    {!!presentation.cards.length && <div className="information-grid">
      {presentation.cards.map(card => <article className="information-card" key={card.id}>
        {card.badge && <span className="information-badge">{card.badge}</span>}
        <h4>{card.title}</h4>
        {card.description && <p dir="auto">{card.description}</p>}
        {card.progress != null && <progress max={100} value={card.progress} aria-label={`התקדמות צפייה: ${card.progress}%`} />}
        <dl>{card.facts.map((fact, index) => <div key={`${fact.label}-${index}`}><dt>{fact.label}</dt><dd><bdi>{fact.value}</bdi></dd></div>)}</dl>
      </article>)}
    </div>}
    {presentation.invoices.map(invoice => <InvoiceStatement key={invoice.id} invoice={invoice} />)}
  </div>;
}
