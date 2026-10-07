// Select records locally so the answer and the statement refer to the same bills.
function invoiceMonth(invoice) {
  const value = invoice.periodStart || invoice.date || invoice.id;
  const iso = value.match(/^(20\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const local = value.match(/^\d{1,2}[./](\d{1,2})[./](20\d{2})$/);
  return local ? `${local[2]}-${local[1].padStart(2, "0")}` : "";
}

export function billingForQuestion(message, billing) {
  if (!billing) return null;
  const invoices = [...(billing.invoices || [])].sort((a, b) =>
    invoiceMonth(b).localeCompare(invoiceMonth(a)),
  );
  let selected;
  const referenced = invoices.filter(
    (invoice) =>
      message.includes(invoice.id) || (invoice.reference && message.includes(invoice.reference)),
  );
  const date = message.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])(?:[-/.]\d{1,2})?\b/);
  const reverseDate = message.match(/\b(0?[1-9]|1[0-2])[-/.](20\d{2})\b/);
  const months = [
    "ינואר|january|jan",
    "פברואר|february|feb",
    "מרץ|march|mar",
    "אפריל|april|apr",
    "מאי|may",
    "יוני|june|jun",
    "יולי|july|jul",
    "אוגוסט|august|aug",
    "ספטמבר|september|sep",
    "אוקטובר|october|oct",
    "נובמבר|november|nov",
    "דצמבר|december|dec",
  ];
  const monthIndex = months.findIndex((pattern) =>
    new RegExp(`(?<![\\p{L}])(?:${pattern})(?![\\p{L}])`, "iu").test(message),
  );
  const year = message.match(/\b20\d{2}\b/)?.[0];
  if (referenced.length) selected = referenced;
  else if (date || reverseDate || monthIndex >= 0) {
    const month = String(
      date ? Number(date[2]) : reverseDate ? Number(reverseDate[1]) : monthIndex + 1,
    ).padStart(2, "0");
    const requestedYear = date?.[1] || reverseDate?.[2] || year;
    selected = invoices.filter(
      (invoice) =>
        invoiceMonth(invoice).slice(5, 7) === month &&
        (!requestedYear || invoiceMonth(invoice).startsWith(requestedYear)),
    );
  } else if (year) selected = invoices.filter((invoice) => invoiceMonth(invoice).startsWith(year));
  else if (/חודש שעבר|חודש הקודם|last month|previous month/i.test(message)) {
    const now = new Date();
    const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
      .toISOString()
      .slice(0, 7);
    selected = invoices.filter((invoice) => invoiceMonth(invoice) === previous);
  } else if (
    /השוו|השווא|התייקר|עלה|עלייה|כל החשבונ|כל החשבוניו|compare|increase|higher|all (?:my )?(?:bills|invoices)/i.test(
      message,
    )
  )
    selected = invoices;
  else selected = invoices.slice(0, 1);
  return { ...billing, invoices: selected };
}
