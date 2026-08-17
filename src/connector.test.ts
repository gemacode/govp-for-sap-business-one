import { describe, expect, it } from 'vitest';
import type { GovpExchangeClient, IssuanceInput } from '@gemacode/govp-connector-kit';
import { B1ServiceLayerClient, MemoryB1GovpStore, SapBusinessOneGovpConnector, b1DocumentSha256, type B1Document, type B1WebhookNotification } from './index.js';

const delivery: B1Document = {
  DocEntry: 42, DocNum: 9001, DocDate: '2026-08-17', CardCode: 'C20000', Cancelled: 'tNO', DocumentStatus: 'bost_Close',
  DocumentLines: [
    { LineNum: 1, ItemCode: 'B', Quantity: 2, WarehouseCode: '01', UnitOfMeasurement: 'EA', BatchNumbers: [{ BatchNumber: 'L2', Quantity: 2 }] },
    { LineNum: 0, ItemCode: 'A', Quantity: 1, WarehouseCode: '01', UnitOfMeasurement: 'EA', SerialNumbers: [{ InternalSerialNumber: 'S1' }] },
  ],
};

const notification = (overrides: Partial<B1WebhookNotification> = {}): B1WebhookNotification => ({
  BusinessObject: 'DeliveryNotes', TransactionType: 'Created', DocEntry: 42,
  EventId: 'evt-42-1', EventTime: '2026-08-17T13:00:00.000Z', ...overrides,
});

function fixture(options: { mode?: 'observe' | 'issue'; receiptCode?: unknown; validityDays?: number } = {}) {
  const documents = new Map<string, B1Document>([
    ['DeliveryNotes:42', structuredClone(delivery)],
    ['PurchaseDeliveryNotes:77', { ...structuredClone(delivery), DocEntry: 77, U_GOVP_Code: options.receiptCode }],
  ]);
  const patches: Array<Record<string, string>> = [];
  const sap = {
    async getDocument(entity: 'DeliveryNotes' | 'PurchaseDeliveryNotes', docEntry: number) { return structuredClone(documents.get(`${entity}:${docEntry}`)!); },
    async patchDelivery(_docEntry: number, fields: Record<string, string>) { patches.push(fields); },
  } as B1ServiceLayerClient;
  const issueCalls: Array<{ input: IssuanceInput; key: string }> = [];
  const exchange = {
    async issue(input: IssuanceInput, key: string) {
      issueCalls.push({ input, key });
      return { ok: true, replayed: false, govp: { id: 'id-42', code: 'GOVP-42', status: 'active', issuedAt: '2026-08-17T13:00:00Z', validUntil: input.validUntil, verifyUrl: 'https://partners.gemacode.org/exchange/comprobar/GOVP-42', apiUrl: 'https://partners.gemacode.org/exchange/api/GOVP-42', downloadUrl: 'https://partners.gemacode.org/exchange/download/GOVP-42' } };
    },
    async verify(code: string) { return { ok: true, verification: { status: code === 'GOVP-42' ? 'valid' : 'revoked', reasonCode: code === 'GOVP-42' ? 'GOVP_VALID' : 'GOVP_REVOKED', integrityValid: true }, govp: {}, lifecycle: {} }; },
  } as GovpExchangeClient;
  const store = new MemoryB1GovpStore();
  const connector = new SapBusinessOneGovpConnector({
    mode: options.mode ?? 'issue', systemId: 'B1-DEMO', issuerName: 'Empresa B1',
    deliveryCodeField: 'U_GOVP_Code', deliveryUrlField: 'U_GOVP_URL', receiptGovpField: 'U_GOVP_Code',
    validityDays: options.validityDays,
  }, sap, exchange, store);
  return { connector, store, patches, issueCalls };
}

describe('GOVP for SAP Business One', () => {
  it('genera una huella estable con posiciones, lotes y series ordenados', () => {
    const reversed = structuredClone(delivery);
    reversed.DocumentLines!.reverse();
    expect(b1DocumentSha256(reversed)).toBe(b1DocumentSha256(delivery));
    reversed.DocumentLines![0]!.Quantity = 99;
    expect(b1DocumentSha256(reversed)).not.toBe(b1DocumentSha256(delivery));
  });

  it('mantiene Observe sin emitir ni escribir en SAP', async () => {
    const { connector, patches, issueCalls } = fixture({ mode: 'observe' });
    await expect(connector.handle(notification())).resolves.toMatchObject({ outcome: 'observed' });
    expect(issueCalls).toHaveLength(0);
    expect(patches).toHaveLength(0);
  });

  it('emite con origen e idempotencia canónicos y enlaza los UDF configurados', async () => {
    const { connector, patches, issueCalls } = fixture();
    await expect(connector.handle(notification())).resolves.toMatchObject({ outcome: 'issued', record: { code: 'GOVP-42' } });
    expect(issueCalls).toHaveLength(1);
    expect(issueCalls[0]!.key).toMatch(/^sap-b1:[a-f0-9]{16}:delivery:42$/);
    expect(issueCalls[0]!.input.source).toEqual({ platform: 'sap_business_one', externalId: 'delivery-42' });
    expect(issueCalls[0]!.input.validUntil).toBe('2027-08-17T00:00:00.000Z');
    expect(patches).toEqual([{ U_GOVP_Code: 'GOVP-42', U_GOVP_URL: 'https://partners.gemacode.org/exchange/comprobar/GOVP-42' }]);
  });

  it('calcula la vigencia desde DocDate de forma estable entre ejecuciones', async () => {
    const first = fixture({ validityDays: 30 });
    const second = fixture({ validityDays: 30 });
    await first.connector.handle(notification());
    await second.connector.handle(notification({ EventId: 'evt-retry', EventTime: '2026-08-18T18:00:00.000Z' }));
    expect(first.issueCalls[0]!.input.validUntil).toBe('2026-09-16T00:00:00.000Z');
    expect(second.issueCalls[0]!.input.validUntil).toBe(first.issueCalls[0]!.input.validUntil);
  });

  it('no duplica una emisión ni acepta un evento más antiguo', async () => {
    const { connector, issueCalls } = fixture();
    await connector.handle(notification());
    await expect(connector.handle(notification())).resolves.toMatchObject({ outcome: 'duplicate' });
    await expect(connector.handle(notification({ EventId: 'old', EventTime: '2026-08-17T12:00:00Z' }))).resolves.toMatchObject({ outcome: 'duplicate' });
    expect(issueCalls).toHaveLength(1);
  });

  it('comprueba el GOVP indicado en una entrada de mercancías', async () => {
    const { connector } = fixture({ receiptCode: 'GOVP-42' });
    await expect(connector.handle(notification({ BusinessObject: 'PurchaseDeliveryNotes', DocEntry: 77 }))).resolves.toMatchObject({ outcome: 'verified', record: { reasonCode: 'GOVP_VALID' } });
  });

  it('deja la entrada sin referencia como ignorada y una revocada en atención', async () => {
    await expect(fixture().connector.handle(notification({ BusinessObject: 'PurchaseDeliveryNotes', DocEntry: 77 }))).resolves.toMatchObject({ outcome: 'ignored' });
    await expect(fixture({ receiptCode: 'REVOKED' }).connector.handle(notification({ BusinessObject: 'PurchaseDeliveryNotes', DocEntry: 77 }))).resolves.toMatchObject({ outcome: 'attention', record: { reasonCode: 'GOVP_REVOKED' } });
  });

  it('rechaza UDF arbitrarios y Service Layer sin OData v4 seguro', () => {
    const exchange = {} as GovpExchangeClient;
    const sap = {} as B1ServiceLayerClient;
    expect(() => new SapBusinessOneGovpConnector({ mode: 'issue', systemId: 'x', issuerName: 'x', receiptGovpField: 'U_bad-value' }, sap, exchange, new MemoryB1GovpStore())).toThrow('UDF');
    expect(() => new SapBusinessOneGovpConnector({ mode: 'issue', systemId: 'x', issuerName: 'x', validityDays: 0 }, sap, exchange, new MemoryB1GovpStore())).toThrow('validityDays');
    expect(() => new B1ServiceLayerClient({ baseUrl: 'http://sap.example/b1s/v2', credentials: { companyDb: 'x', userName: 'x', password: 'x' } })).toThrow('HTTPS');
    expect(() => new B1ServiceLayerClient({ baseUrl: 'https://sap.example/b1s/v1', credentials: { companyDb: 'x', userName: 'x', password: 'x' } })).toThrow('OData v4');
  });

  it('inicia sesión, reutiliza B1SESSION y consulta por DocEntry', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input); calls.push({ url, init });
      if (url.endsWith('/Login')) return new Response(JSON.stringify({ SessionId: 'session-ci', SessionTimeout: 30 }), { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'B1SESSION=session-ci; ROUTEID=.node1' } });
      return new Response(JSON.stringify(delivery), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const client = new B1ServiceLayerClient({ baseUrl: 'http://localhost/b1s/v2', credentials: { companyDb: 'SBODEMOES', userName: 'manager', password: 'not-a-real-secret' }, fetch: fetcher });
    await client.getDocument('DeliveryNotes', 42);
    await client.getDocument('DeliveryNotes', 42);
    expect(calls.filter((call) => call.url.endsWith('/Login'))).toHaveLength(1);
    expect(new Headers(calls[1]!.init?.headers).get('Cookie')).toContain('B1SESSION=session-ci');
  });
});
