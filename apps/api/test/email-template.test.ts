import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authEmailContent } from '../src/auth/auth.email.js';
import { renderEmail } from '../src/auth/email-template.js';

test('email html escapes every value and keeps a plain-text twin', () => {
  const email = renderEmail({
    subject: 'A bank account was added',
    preheader: 'Security update',
    heading: 'A bank account was added',
    paragraphs: ['<script>alert(1)</script> & "Ada" \'Okafor\''],
    button: { label: 'Open', url: 'https://x.test/a?b=1&c="2"' },
    note: '<b>note</b>',
  });
  assert.doesNotMatch(email.html, /<script>|<b>note/);
  assert.match(
    email.html,
    /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;Ada&quot; &#39;Okafor&#39;/,
  );
  assert.match(
    email.html,
    /href="https:\/\/x\.test\/a\?b=1&amp;c=&quot;2&quot;"/,
  );
  assert.match(email.text, /<script>alert\(1\)<\/script>/);
  assert.match(email.text, /Open: https:\/\/x\.test\/a\?b=1&c="2"/);
});

test('verification and reset emails carry a button, the link and its lifetime', () => {
  const url = 'https://api.acticlaim.test/verify?token=secret';
  const verify = authEmailContent({
    kind: 'verify-email',
    to: 'a@b.test',
    url,
  });
  assert.equal(verify.subject, 'Confirm your email for Acticlaim');
  assert.match(verify.html, /Confirm email<\/a>/);
  assert.match(verify.text, /1 hour/);
  const reset = authEmailContent({
    kind: 'reset-password',
    to: 'a@b.test',
    url,
  });
  assert.match(reset.text, /30 minutes/);
  assert.match(reset.html, new RegExp(url.replace(/[.?]/g, '\\$&')));
});
