# GOVP for SAP Business One

Conector abierto entre **SAP Business One Service Layer** y GOVP Exchange.
Emite un GOVP desde una entrega de ventas (`DeliveryNotes`) y comprueba la
referencia recibida en una entrada de mercancías de compra
(`PurchaseDeliveryNotes`).

> Estado: candidato técnico `0.1.1`. Las pruebas deterministas no sustituyen la
> aceptación en una instalación SAP Business One real.

## Alcance

- Service Layer OData v4 bajo `/b1s/v2` y sesión `B1SESSION` reutilizable;
- modo seguro `observe` y modo explícito `issue`;
- huella canónica de documento, posiciones, almacén, lotes y series;
- idempotencia aislada por sistema SAP y `DocEntry`;
- vigencia determinista calculada desde `DocDate`, estable también en reintentos;
- enlace opcional mediante UDF configurables, sin modificar el core de SAP;
- comprobación en recepción y estado de atención para GOVP no válido;
- eventos creados/actualizados, duplicados y fuera de orden;
- reintentos acotados para 429/5xx y renovación de sesión tras 401.

SAP recomienda actualmente OData v4 para Service Layer. Los webhooks nativos
requieren SAP Business One 10.0 FP 2602 o posterior; en versiones anteriores el
mismo manejador puede invocarse desde un sondeo o Integration Framework.

- [Service Layer API Reference](https://help.sap.com/doc/056f69366b5345a386bb8149f1700c19/10.0/en-US/Service%20Layer%20API%20Reference.html)
- [Webhooks de Service Layer](https://help.sap.com/docs/SAP_BUSINESS_ONE/f110a154dd0f4c20bf7f3ebca9eeb794/0a53110984224534a8e64f2df8d77f91.html)

## Desarrollo

```bash
npm ci
npm run check
```

```ts
import { GovpExchangeClient } from '@gemacode/govp-connector-kit';
import { B1ServiceLayerClient, MemoryB1GovpStore, SapBusinessOneGovpConnector } from '@gemacode/govp-for-sap-business-one';

const sap = new B1ServiceLayerClient({
  baseUrl: process.env.SAP_B1_BASE_URL!,
  credentials: {
    companyDb: process.env.SAP_B1_COMPANY_DB!,
    userName: process.env.SAP_B1_USER!,
    password: process.env.SAP_B1_PASSWORD!,
  },
});
const exchange = new GovpExchangeClient({
  baseUrl: process.env.GOVP_EXCHANGE_URL!,
  token: process.env.GOVP_CONNECTOR_TOKEN!,
});
const connector = new SapBusinessOneGovpConnector({
  mode: 'observe',
  systemId: 'sap-b1-production',
  issuerName: 'Empresa emisora',
  receiptGovpField: 'U_GOVP_Code',
  deliveryCodeField: 'U_GOVP_Code',
  deliveryUrlField: 'U_GOVP_URL',
}, sap, exchange, new MemoryB1GovpStore());
```

`MemoryB1GovpStore` es únicamente una referencia para pruebas. Un despliegue
real debe proporcionar almacenamiento transaccional persistente y una cola con
reclamación atómica.

## Puerta nativa

La matriz completa está en `SANDBOX_ACCEPTANCE.md`. Hasta superarla, el producto
debe presentarse como candidato y no como integración SAP validada.

SAP y SAP Business One son marcas de SAP SE. Este proyecto no está afiliado ni
certificado por SAP. La conformidad GOVP es técnica, no legal ni comercial.

## Licencia

Apache-2.0.
