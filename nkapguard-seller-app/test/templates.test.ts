import { describe, expect, it } from 'vitest';
import { submitTemplates, templateSpecs } from '../src/services/templates.js';
import { setup } from './helpers.js';

describe('WhatsApp template submission', () => {
  it('builds every template with a sample value for each slot', async () => {
    const { ctx } = await setup();
    const specs = templateSpecs(ctx);
    expect(specs).toHaveLength(19);
    for (const s of specs.filter((x) => x.category !== 'AUTHENTICATION')) {
      const body = s.components[0] as { text: string; example: { body_text: string[][] } };
      const slotsInText = body.text.match(/\{\{\d+\}\}/g)!.length;
      expect(body.example.body_text[0]).toHaveLength(slotsInText);
      expect(body.example.body_text[0].every((v) => v.trim() !== '')).toBe(true);
      // Meta rejects a body that starts or ends with a variable.
      expect(body.text.trim()).not.toMatch(/^\{\{|\}\}$/);
    }
    expect(specs.find((s) => s.name === 'restock_hold_v1_bilingual')?.language).toBe('fr');
    expect(specs.find((s) => s.category === 'AUTHENTICATION')?.name).toBe('login_code_v1');
  });

  it('submits only what Meta does not already have', async () => {
    const { ctx } = await setup();
    const posted: { name: string; language: string }[] = [];
    ctx.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const b = JSON.parse(String(init.body));
        posted.push({ name: b.name, language: b.language });
        if (b.name === 'payment_refund_v1' && b.language === 'fr') return new Response(JSON.stringify({ error: { message: 'Invalid parameter', error_user_msg: 'Too many variables' } }), { status: 400 });
        return new Response(JSON.stringify({ id: '1', status: 'PENDING', category: b.category }));
      }
      expect(String(input)).toContain('/555/message_templates');
      return new Response(JSON.stringify({ data: [{ name: 'payment_received_v1', language: 'en', status: 'APPROVED' }] }));
    }) as typeof fetch;
    const r = await submitTemplates(ctx, '555');
    expect(r).toHaveLength(19);
    expect(posted).toHaveLength(18);
    expect(r.find((t) => t.name === 'payment_received_v1' && t.language === 'en')?.status).toBe('APPROVED');
    expect(r.find((t) => t.name === 'payment_refund_v1' && t.language === 'fr')).toMatchObject({ status: 'NOT_SUBMITTED', error: 'Too many variables' });
  });
});
