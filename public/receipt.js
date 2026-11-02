// Builds a PDF payment receipt with jsPDF (jspdf.min.js must be loaded first).
async function makeReceipt(r) {
  const { jsPDF } = window.jspdf, d = new jsPDF({ unit: 'mm', format: 'a5' }), W = 148, M = 14;
  const fm = n => r.currency + ' ' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const ts = String(r.ts || '').includes('T') ? r.ts : String(r.ts || '').replace(' ', 'T') + 'Z';
  const dt = new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  let y = 16, x = M;
  if (r.logo) {
    try {
      const im = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = r.logo; });
      const h = 14, w = Math.min(40, h * im.width / im.height);
      d.addImage(r.logo, /png/i.test(r.logo.slice(0, 24)) ? 'PNG' : 'JPEG', M, y - 4, w, h); x = M + w + 5;
    } catch (e) {}
  }
  d.setFont('helvetica', 'bold').setFontSize(16).setTextColor(15, 118, 110).text(r.name, x, y + 2);
  d.setFont('helvetica', 'normal').setFontSize(9).setTextColor(90, 101, 120);
  if (r.showroom) d.text(d.splitTextToSize(r.showroom, W - x - M), x, y + 8);
  y = 38; d.setDrawColor(228, 232, 239).line(M, y, W - M, y);
  d.setFont('helvetica', 'bold').setFontSize(13).setTextColor(20, 33, 61).text('PAYMENT RECEIPT', M, y + 9);
  d.setFont('helvetica', 'normal').setFontSize(9).setTextColor(90, 101, 120).text('Receipt no: ' + r.no, W - M, y + 5, { align: 'right' }).text(dt, W - M, y + 10, { align: 'right' });
  y += 22;
  const row = (k, v, bold) => {
    d.setFont('helvetica', 'normal').setFontSize(9).setTextColor(90, 101, 120).text(k, M, y);
    d.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(bold ? 11 : 10).setTextColor(20, 33, 61);
    const L = d.splitTextToSize(String(v), 80); d.text(L, W - M, y, { align: 'right' }); y += 7 + (L.length - 1) * 4.5;
  };
  row('Received from', r.client); row('For', r.service + (r.items ? ' (' + r.items + ')' : ''));
  y += 1; d.setDrawColor(228, 232, 239).line(M, y, W - M, y); y += 8;
  row('Amount received', fm(r.amount), true); y += 2;
  if (r.price > 0) { row('Total price', fm(r.price)); row('Paid to date', fm(r.paidTo)); row('Balance', fm(Math.max(0, r.price - r.paidTo)), true); }
  y += 4; d.line(M, y, W - M, y); y += 8;
  d.setFont('helvetica', 'normal').setFontSize(9).setTextColor(90, 101, 120).text('Thank you for your payment. Please keep this receipt for your records.', M, y, { maxWidth: W - 2 * M });
  return d;
}
