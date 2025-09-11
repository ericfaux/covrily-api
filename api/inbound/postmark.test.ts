import test, { mock } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';

process.env.SUPABASE_URL = 'http://example.com';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

const require = createRequire(import.meta.url);

// stub pdf-parse so we can inspect the buffer passed to it
const pdfParsePath = require.resolve('pdf-parse/lib/pdf-parse.js');
const pdfParseSpy = mock.fn(async () => ({ text: '' }));
require.cache[pdfParsePath] = {
  id: pdfParsePath,
  filename: pdfParsePath,
  loaded: true,
  exports: pdfParseSpy
} as any;

// stub supabase client
const supabasePath = require.resolve('@supabase/supabase-js');
const ModuleCtor = require('module');
const supabaseStub = new ModuleCtor.Module(supabasePath);
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
supabaseStub.exports = { createClient: () => fakeSupabase };
supabaseStub.loaded = true;
require.cache[supabasePath] = supabaseStub as any;

const postmarkMod = await import('./postmark.js');
const handler = postmarkMod.default;
const { naiveParse } = postmarkMod;
const { default: parseHmPdf } = await import('../../lib/pdf.js');

test('passes decoded PDF buffer to parseHmPdf', async () => {
  pdfParseSpy.mock.resetCalls();

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
  const res: any = { status() { return { json() { return null; } }; } };

  await handler(req, res);

  assert.strictEqual(pdfParseSpy.mock.callCount(), 1);
  const arg = (pdfParseSpy.mock.calls as any[])[0].arguments[0];
  assert.ok(Buffer.isBuffer(arg));
  assert.deepStrictEqual(arg, Buffer.from(b64, 'base64'));
});

test('parseHmPdf throws on empty input', async () => {
  await assert.rejects(() => parseHmPdf(undefined as any), /empty pdf buffer/);
});

test('reads attachment from file path when not base64', async () => {
  pdfParseSpy.mock.resetCalls();

  const tmpDir = await fs.mkdtemp(`${os.tmpdir()}/`);
  const filePath = `${tmpDir}/test.pdf`;
  await fs.writeFile(filePath, Buffer.from('fake pdf'));

  const req: any = {
    method: 'POST',
    body: {
      MailboxHash: 'user-123',
      Attachments: [
        {
          ContentType: 'application/pdf',
          Content: filePath,
          Name: 'receipt.pdf'
        }
      ]
    }
  };
  const res: any = { status() { return { json() { return null; } }; } };

  await handler(req, res);

  assert.strictEqual(pdfParseSpy.mock.callCount(), 1);
  const arg = (pdfParseSpy.mock.calls as any[])[0].arguments[0];
  assert.ok(Buffer.isBuffer(arg));
  assert.deepStrictEqual(arg, Buffer.from('fake pdf'));
});

test('naiveParse extracts data for best buy', () => {
  const subject = 'Best Buy order number 123-456';
  const body = 'Total: $1,234.56';
  const parsed = naiveParse(subject, body);
  assert.deepStrictEqual(parsed, {
    merchant: 'bestbuy.com',
    order_id: '123-456',
    total_cents: 123456
  });
});

test('naiveParse extracts data for target', () => {
  const subject = 'Your Target order #A1B2C3 has shipped';
  const body = 'Total: $45.67';
  const parsed = naiveParse(subject, body);
  assert.deepStrictEqual(parsed, {
    merchant: 'target.com',
    order_id: 'a1b2c3',
    total_cents: 4567
  });
});

test('naiveParse extracts data for walmart', () => {
  const subject = 'Walmart.com order number 78910';
  const body = 'Amount: $98.76';
  const parsed = naiveParse(subject, body);
  assert.deepStrictEqual(parsed, {
    merchant: 'walmart.com',
    order_id: '78910',
    total_cents: 9876
  });
});

test('naiveParse extracts data for h&m', () => {
  const subject = 'H&M Order 2468';
  const body = 'Amount: $12.34';
  const parsed = naiveParse(subject, body);
  assert.deepStrictEqual(parsed, {
    merchant: 'hm.com',
    order_id: '2468',
    total_cents: 1234
  });
});

