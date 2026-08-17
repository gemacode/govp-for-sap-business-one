import type { GovpReference } from '@gemacode/govp-connector-kit';

export type B1DocumentLine = {
  LineNum: number;
  ItemCode?: string;
  Quantity?: number;
  WarehouseCode?: string;
  UnitOfMeasurement?: string;
  BatchNumbers?: Array<{ BatchNumber?: string; Quantity?: number }>;
  SerialNumbers?: Array<{ InternalSerialNumber?: string; ManufacturerSerialNumber?: string }>;
};

export type B1Document = {
  DocEntry: number;
  DocNum?: number;
  DocDate?: string;
  DocDueDate?: string;
  CardCode?: string;
  Cancelled?: 'tYES' | 'tNO';
  DocumentStatus?: 'bost_Open' | 'bost_Close';
  DocumentLines?: B1DocumentLine[];
  [field: `U_${string}`]: unknown;
};

export type B1WebhookNotification = {
  BusinessObject: 'DeliveryNotes' | 'PurchaseDeliveryNotes';
  TransactionType: 'Created' | 'Updated';
  DocEntry: number;
  EventId: string;
  EventTime: string;
};

export type B1GovpRecord = {
  key: string;
  eventId: string;
  eventTime: string;
  kind: 'delivery' | 'receipt';
  docEntry: number;
  status: 'observed' | 'issued' | 'verified' | 'ignored' | 'attention';
  code?: string;
  verifyUrl?: string;
  reasonCode?: string;
  govp?: GovpReference;
};

export interface B1GovpStore {
  get(key: string): Promise<B1GovpRecord | undefined>;
  save(record: B1GovpRecord): Promise<void>;
}

export type B1ConnectorConfig = {
  mode: 'observe' | 'issue';
  systemId: string;
  issuerName: string;
  receiptGovpField?: `U_${string}`;
  deliveryCodeField?: `U_${string}`;
  deliveryUrlField?: `U_${string}`;
  validityDays?: number;
};
