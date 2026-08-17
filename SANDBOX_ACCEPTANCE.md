# Aceptación nativa — SAP Business One

Registrar versión exacta, base HANA o SQL, sistema operativo de Service Layer,
usuario técnico, fecha y resultado. No almacenar secretos ni datos de clientes.

1. Confirmar SAP Business One 10.0, `/b1s/v2/$metadata` y las entidades
   `DeliveryNotes` y `PurchaseDeliveryNotes`.
2. Crear un usuario técnico de mínimo privilegio y comprobar login, expiración,
   renovación y cierre de sesión.
3. Crear los UDF `U_GOVP_Code` y `U_GOVP_URL`, o documentar una estrategia
   side-by-side sin escritura en SAP.
4. Ejecutar primero modo `observe` sobre una entrega sin alterar el documento.
5. Emitir al crear/cerrar una entrega con dos posiciones, lote y número de serie;
   repetir la notificación y demostrar una sola emisión.
6. Crear una entrada de mercancías con GOVP válido, revocado y ausente, y
   comprobar los tres resultados sin bloquear la contabilización.
7. Probar entrega parcial, devolución, documento cancelado, dos almacenes y dos
   sociedades sin contaminación cruzada.
8. Interrumpir Exchange y Service Layer, verificar reintento acotado,
   reconciliación, atención humana y ausencia de duplicados.
9. Si el sistema es FP 2602 o posterior, habilitar Webhook Messenger, registrar
   `EventSubscriptions` y verificar autenticación, lotes, reintentos y mensajes
   duplicados. En versiones anteriores, validar el sondeo acordado.
10. Actualizar y retirar el adaptador preservando referencias GOVP y eliminando
    credenciales, suscripciones y UDF solo con autorización explícita.

La aceptación requiere evidencia reproducible de los diez pasos y aprobación
del responsable funcional de SAP Business One.
