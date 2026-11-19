// Tiny text-only PDF writer (A4, Helvetica). Used for e-contracts and police handover exports.
// Non-Latin text (Bangla) is transliterated to '?' because the base fonts are Latin-1 only.
function esc(s) {
  return String(s)
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}
function wrap(text, max) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/)) {
      if ((line + ' ' + w).trim().length > max) {
        if (line) out.push(line);
        line = w.length > max ? w.slice(0, max) : w;
      } else line = (line + ' ' + w).trim();
    }
    out.push(line);
  }
  return out;
}

// blocks: [{ text, size?, bold?, gap? }]
export function makePdf(blocks, { title = 'Document' } = {}) {
  const pages = [];
  let cur = [];
  let y = 800;
  const newPage = () => { pages.push(cur); cur = []; y = 800; };
  for (const b of blocks) {
    const size = b.size || 10;
    const lh = size * 1.4;
    const lines = wrap(b.text ?? '', Math.floor(500 / (size * 0.5)));
    y -= b.gap ?? 4;
    for (const ln of lines) {
      if (y < 50) newPage();
      cur.push(`BT /${b.bold ? 'F2' : 'F1'} ${size} Tf 50 ${y.toFixed(1)} Td (${esc(ln)}) Tj ET`);
      y -= lh;
    }
  }
  pages.push(cur);
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add('');
  const pagesObj = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = [];
  pages.forEach((lines, i) => {
    const footer = `BT /F1 8 Tf 50 25 Td (${esc(`${title} - page ${i + 1} of ${pages.length}`)}) Tj ET`;
    const stream = [...lines, footer].join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
