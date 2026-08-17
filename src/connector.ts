import { createHash } from 'node:crypto';
import type { GovpExchangeClient } from '@gemacode/govp-connector-kit';
import type { B1ServiceLayerClient } from './service-layer.js';
import type { B1ConnectorConfig, B1Document, B1GovpRecord, B1GovpStore, B1WebhookNotification } from './types.js';

function canonicalDocument(document: B1Document) {
  return {
    docEntry: document.DocEntry,
    docNum: document.DocNum ?? null,
    docDate: document.DocDate ?? null,
    cardCode: document.CardCode ?? null,
    lines: (document.DocumentLines ?? []).map((line) => ({
      line: line.LineNum,
      itemCode: line.ItemCode ?? null,
      quantity: line.Quantity ?? null,
      unit: line.UnitOfMeasurement ?? null,
      warehouse: line.WarehouseCode ?? null,
      batches: (line.BatchNumbers ?? []).map((batch) => ({ number: batch.BatchNumber ?? null, quantity: batch.Quantity ?? null }))
        .sort((a, b) => String(a.number).localeCompare(String(b.number))),
      serials: (line.SerialNumbers ?? []).map((serial) => serial.InternalSerialNumber ?? serial.ManufacturerSerialNumber ?? null)
        .sort((a, b) => String(a).localeCompare(String(b))),
    })).sort((a, b) => a.line - b.line),
  };
}

export function b1DocumentSha256(document: B1Document) {
  return createHash('sha256').update(JSON.stringify(canonicalDocument(document))).digest('hex');
}

function field(value: string | undefined) {
  if (!value) return undefined;
  if (!/^U_[A-Za-z][A-Za-z0-9_]{0,77}$/.test(value)) throw new TypeError(`Campo UDF no válido: ${value}`);
  return value as `U_${string}`;
}

function time(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError('EventTime debe ser una fecha ISO válida.');
  return parsed;
}

export class SapBusinessOneGovpConnector {
  private readonly config: B1ConnectorConfig;

  constructor(
    config: B1ConnectorConfig,
    private readonly sap: B1ServiceLayerClient,
    private readonly exchange: GovpExchangeClient,
    private readonly store: B1GovpStore,
  ) {
    this.config = {
      ...config,
      systemId: config.systemId.trim(),
      issuerName: config.issuerName.trim(),
      receiptGovpField: field(config.receiptGovpField),
      deliveryCodeField: field(config.deliveryCodeField),
      deliveryUrlField: field(config.deliveryUrlField),
    };
    if (!this.config.systemId || !this.config.issuerName) throw new TypeError('systemId e issuerName son obligatorios.');
  }

  async handle(notification: B1WebhookNotification) {
    if (!notification.EventId || !notification.DocEntry) throw new TypeError('Notificación SAP Business One incompleta.');
    return notification.BusinessObject === 'DeliveryNotes' ? this.issue(notification) : this.verify(notification);
  }

  private async prior(notification: B1WebhookNotification, key: string) {
    const record = await this.store.get(key);
    if (record?.eventId === notification.EventId || ['issued', 'verified'].includes(record?.status ?? '')) return { record, outcome: 'duplicate' as const };
    if (record && time(notification.EventTime) < time(record.eventTime)) return { record, outcome: 'ignored' as const };
    return undefined;
  }

  private async issue(notification: B1WebhookNotification) {
    const key = `delivery:${notification.DocEntry}`;
    const prior = await this.prior(notification, key);
    if (prior) return prior;
    const document = await this.sap.getDocument('DeliveryNotes', notification.DocEntry);
    if (document.Cancelled === 'tYES') return this.saveIgnored(notification, key, 'delivery');
    if (this.config.mode === 'observe') {
      const record: B1GovpRecord = { key, eventId: notification.EventId, eventTime: notification.EventTime, kind: 'delivery', docEntry: notification.DocEntry, status: 'observed' };
      await this.store.save(record);
      return { outcome: 'observed' as const, record };
    }
    const systemHash = createHash('sha256').update(this.config.systemId).digest('hex').slice(0, 16);
    const result = await this.exchange.issue({
      issuer: { name: this.config.issuerName },
      subject: { type: 'shipment', id: String(document.DocEntry), name: `SAP Business One Delivery ${document.DocNum ?? document.DocEntry}`, description: `${document.DocumentLines?.length ?? 0} posiciones expedidas` },
      requirement: 'Demuestra una entrega de SAP Business One mediante la huella de sus datos logísticos mínimos.',
      evidence: [{ label: 'Huella canónica de SAP Business One Delivery', sha256: b1DocumentSha256(document) }],
      validUntil: new Date(Date.now() + (this.config.validityDays ?? 365) * 86_400_000).toISOString(),
      source: { platform: 'sap_business_one', externalId: `delivery-${document.DocEntry}` },
    }, `sap-b1:${systemHash}:delivery:${document.DocEntry}`);
    const record: B1GovpRecord = { key, eventId: notification.EventId, eventTime: notification.EventTime, kind: 'delivery', docEntry: document.DocEntry, status: 'issued', code: result.govp.code, verifyUrl: result.govp.verifyUrl, govp: result.govp };
    await this.store.save(record);
    const fields = Object.fromEntries([
      this.config.deliveryCodeField ? [this.config.deliveryCodeField, result.govp.code] : undefined,
      this.config.deliveryUrlField ? [this.config.deliveryUrlField, result.govp.verifyUrl] : undefined,
    ].filter((entry): entry is [string, string] => Boolean(entry)));
    if (Object.keys(fields).length) await this.sap.patchDelivery(document.DocEntry, fields);
    return { outcome: 'issued' as const, record };
  }

  private async verify(notification: B1WebhookNotification) {
    const key = `receipt:${notification.DocEntry}`;
    const prior = await this.prior(notification, key);
    if (prior) return prior;
    const document = await this.sap.getDocument('PurchaseDeliveryNotes', notification.DocEntry);
    const code = this.config.receiptGovpField ? document[this.config.receiptGovpField] : undefined;
    if (typeof code !== 'string' || !code.trim()) return this.saveIgnored(notification, key, 'receipt');
    const result = await this.exchange.verify(code.trim());
    const valid = result.verification.status === 'valid' && result.verification.integrityValid;
    const record: B1GovpRecord = { key, eventId: notification.EventId, eventTime: notification.EventTime, kind: 'receipt', docEntry: document.DocEntry, status: valid ? 'verified' : 'attention', code: code.trim(), reasonCode: result.verification.reasonCode };
    await this.store.save(record);
    return { outcome: record.status, record, verification: result.verification };
  }

  private async saveIgnored(notification: B1WebhookNotification, key: string, kind: B1GovpRecord['kind']) {
    const record: B1GovpRecord = { key, eventId: notification.EventId, eventTime: notification.EventTime, kind, docEntry: notification.DocEntry, status: 'ignored' };
    await this.store.save(record);
    return { outcome: 'ignored' as const, record };
  }
}
