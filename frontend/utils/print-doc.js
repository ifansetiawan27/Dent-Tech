// Helper: render HTML dokumen ke iframe tersembunyi lalu buka dialog print (Save as PDF).
// Menunggu gambar selesai dimuat sebelum print agar lampiran foto ikut tercetak.
export function printHtml(html) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  const doPrint = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch {}
    setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 4000);
  };

  const imgs = Array.from(doc.images);
  if (!imgs.length) { setTimeout(doPrint, 250); return; }
  let pending = imgs.length;
  let done = false;
  const finished = () => { if (!done) { done = true; setTimeout(doPrint, 250); } };
  imgs.forEach((img) => {
    if (img.complete) { pending--; if (pending <= 0) finished(); return; }
    img.addEventListener('load', () => { pending--; if (pending <= 0) finished(); });
    img.addEventListener('error', () => { pending--; if (pending <= 0) finished(); });
  });
  setTimeout(finished, 6000);
}

export const DOC_BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; padding: 32px; font-size: 13px; position: relative; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #2563eb; padding-bottom: 16px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .logo { width: 48px; height: 48px; object-fit: contain; }
  .co { font-weight: 700; font-size: 18px; }
  .co-sub { color: #64748b; font-size: 11px; }
  .doc-title { text-align: right; }
  .doc-title .lbl { text-transform: uppercase; letter-spacing: 2px; color: #64748b; font-size: 11px; }
  .doc-title .num { font-size: 20px; font-weight: 700; }
  .muted { color: #64748b; }
  .meta { display: flex; justify-content: space-between; margin: 18px 0; gap: 16px; }
  .meta .col { flex: 1; }
  .meta h4 { font-size: 11px; text-transform: uppercase; color: #64748b; letter-spacing: 1px; margin-bottom: 4px; }
  table.grid { width: 100%; border-collapse: collapse; margin-top: 8px; }
  table.grid th { text-align: left; font-size: 11px; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #e2e8f0; padding: 7px; }
  table.grid td { padding: 7px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  .right { text-align: right; } .center { text-align: center; }
  .section-title { font-weight: 700; font-size: 13px; color: #1e293b; margin: 14px 0 6px; padding: 6px 8px; background: #eff6ff; border-left: 3px solid #2563eb; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
  .badge.PASS { background: #d1fae5; color: #065f46; }
  .badge.FAIL { background: #fee2e2; color: #991b1b; }
  .badge.NA { background: #e2e8f0; color: #475569; }
  .badge.EMPTY { background: #f8fafc; color: #cbd5e1; border: 1px dashed #cbd5e1; }
  .foot { margin-top: 28px; padding-top: 12px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 11px; text-align: center; }
  .photos { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
  .photos figure { width: 200px; page-break-inside: avoid; }
  .photos img { width: 100%; height: 140px; object-fit: cover; border-radius: 8px; border: 1px solid #e2e8f0; }
  .photos figcaption { font-size: 10px; color: #64748b; margin-top: 4px; text-align: center; }
  .photo-label { display:inline-block; font-size:9px; font-weight:700; color:#fff; padding:1px 6px; border-radius:4px; margin-bottom:4px; }
  .photo-label.before { background:#475569; } .photo-label.after { background:#059669; } .photo-label.request { background:#d97706; }
  @media print { body { padding: 8mm; } .photos img { height: 120px; } }
`;
