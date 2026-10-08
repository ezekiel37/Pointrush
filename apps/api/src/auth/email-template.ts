// Branded email layout with a plain-text twin. Every value is escaped: names,
// bank details and links are data, never markup. Table layout and inline
// styles because many email apps ignore stylesheets.
export interface EmailContent {
  subject: string;
  preheader: string;
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  note?: string;
}

const escape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const footer =
  'Acticlaim: cash back, prize codes and paid tasks, prepaid by real businesses. Acticlaim will never ask for your password, a PIN or a fee by email.';

export function renderEmail(content: EmailContent) {
  const button = content.button;
  const text = [
    content.heading,
    '',
    ...content.paragraphs.flatMap((p) => [p, '']),
    ...(button ? [`${button.label}: ${button.url}`, ''] : []),
    ...(content.note ? [content.note, ''] : []),
    '—',
    footer,
  ].join('\n');

  const paragraphs = content.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#24302b">${escape(p)}</p>`,
    )
    .join('');
  const action = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="border-radius:999px;background:#0f6e50"><a href="${escape(button.url)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px">${escape(button.label)}</a></td></tr></table>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#5d6862">If the button does not work, copy this link into your browser:<br><a href="${escape(button.url)}" style="color:#0f6e50;word-break:break-all">${escape(button.url)}</a></p>`
    : '';
  const note = content.note
    ? `<p style="margin:0;padding:14px 16px;border-radius:12px;background:#f5f6f4;font-size:13px;line-height:1.5;color:#5d6862">${escape(content.note)}</p>`
    : '';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(content.subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f6f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f4"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 16px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:28px;height:28px;border-radius:8px;background:#0f6e50;text-align:center;font-size:15px;font-weight:700;color:#d4f25a">A</td>
<td style="padding-left:10px;font-size:17px;font-weight:700;color:#0e1512;letter-spacing:-0.3px">Acticlaim</td>
</tr></table></td></tr>
<tr><td style="padding:32px 28px;background:#ffffff;border:1px solid #e6e9e7;border-radius:20px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0e1512;letter-spacing:-0.4px">${escape(content.heading)}</h1>
${paragraphs}${action}${note}
</td></tr>
<tr><td style="padding:20px 8px 0;font-size:12px;line-height:1.5;color:#8b9590;text-align:center">${escape(footer)}</td></tr>
</table></td></tr></table>
</body></html>`;
  return { subject: content.subject, text, html };
}
