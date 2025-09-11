import test, { mock } from 'node:test';
import assert from 'node:assert';

// environment required by handler
process.env.SUPABASE_URL = 'http://example.com';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

test('passes decoded PDF buffer to parseHmPdf', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);

  // stub pdf-parse before lib/pdf.js is imported
  const pdfParsePath = require.resolve('pdf-parse');
  const pdfParseSpy = mock.fn(async () => ({ text: '' }));
  require.cache[pdfParsePath] = {
    id: pdfParsePath,
    filename: pdfParsePath,
    loaded: true,
    exports: pdfParseSpy
  } as any;

  const fakeSupabase = {
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    from: () => ({
      upsert: () => ({
        select: () => ({
          single: async () => ({ data: { id: 1 }, error: null })
        })
      })
    })
  };

  const supabasePath = require.resolve('@supabase/supabase-js');
  const ModuleCtor = require('module');
  const supabaseStub = new ModuleCtor.Module(supabasePath);
  supabaseStub.exports = { createClient: () => fakeSupabase };
  supabaseStub.loaded = true;
  require.cache[supabasePath] = supabaseStub as any;

  await import('../../lib/pdf.js');
  const { default: handler } = await import('./postmark.js');

  const b64 = Buffer.from('fake pdf').toString('base64');
  const req: any = {
    method: 'POST',
    body: {
      MailboxHash: 'user-123',
      Attachments: [
        {
          ContentType: 'application/pdf',
          Content: b64,
          Name: 'receipt.pdf'
        }
      ]
    }
  };

  const res: any = {
    status() { return { json() { return null; } }; }
  };

  await handler(req, res);

  assert.strictEqual(pdfParseSpy.mock.callCount(), 1);
  const arg = (pdfParseSpy.mock.calls as any[])[0].arguments[0];
  assert.ok(Buffer.isBuffer(arg));
  assert.deepStrictEqual(arg, Buffer.from(b64, 'base64'));

  mock.restoreAll();
  delete require.cache[pdfParsePath];
  delete require.cache[supabasePath];
});

test('parseHmPdf throws on empty input', async () => {
  const { default: parseHmPdf } = await import('../../lib/pdf.js');
  await assert.rejects(() => parseHmPdf(undefined as any), /empty pdf buffer/);
});

