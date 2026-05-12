# App móvil: Tendedero Inteligente

Esta carpeta contiene una PWA instalable para celular. Lee los datos que tu NodeMCU ya publica en Firebase RTDB, por eso el código del ESP8266 no necesita una librería nueva.

## Configuración rápida

En `app.js` solo debes revisar estas dos líneas:

```js
firebaseHost: "tendedero-inteligente-df4a2-default-rtdb.firebaseio.com",
deviceId: "tendedero_01",
```

Son equivalentes a usar el host de Firebase y el `DEVICE_ID` de tu sketch de Arduino.

## Cómo probarla

Desde esta carpeta puedes iniciar un servidor local:

```powershell
python -m http.server 8080
```

Luego abre en el navegador:

```text
http://localhost:8080
```

Para instalarla en un celular necesitas publicarla en HTTPS, por ejemplo con GitHub Pages, Netlify o Firebase Hosting. En Android aparecerá la opción **Instalar app** o **Agregar a pantalla principal**. En iPhone se instala desde Safari con **Compartir > Agregar a inicio**.

## Notificaciones

La app muestra alertas en pantalla y puede enviar notificaciones del navegador cuando está instalada o abierta. Para notificaciones push aunque la app esté completamente cerrada, el siguiente paso es agregar Firebase Cloud Messaging.

## Importante

No pongas el `FIREBASE_SECRET`, token de Telegram ni contraseñas dentro de esta app. Esos secretos deben quedar solo en el ESP8266 o en un servidor privado.

## Hacerla independiente de la laptop

La app ya esta preparada para Firebase Hosting. Al subirla, tendras un enlace HTTPS publico y el celular podra instalarla sin depender de tu laptop.

Desde esta carpeta ejecuta:

```powershell
npm install -g firebase-tools
firebase login
firebase deploy
```

Tambien puedes usar el archivo:

```text
SUBIR_A_FIREBASE.bat
```

Firebase entregara un enlace parecido a:

```text
https://tendedero-inteligente-df4a2.web.app
```

Abre ese enlace en el celular:

- Android/Chrome: toca **Instalar app** o **Agregar a pantalla principal**.
- iPhone/Safari: toca **Compartir > Agregar a inicio**.

Despues de eso, la app queda instalada en el celular y lee Firebase directamente por internet.

## Estado de la ropa

La pantalla incluye una tarjeta para indicar:

- Ropa mojada completamente
- Ropa centrifugada / media seca
- Ropa seca o casi seca

Si en Firebase existe `estado/humedad_ropa` o `estado/estado_ropa`, la app usa ese valor. Si no existe, lo estima automaticamente con lluvia, luz y posicion del tendedero.

## Ordenar secado desde la app

La app ahora puede mandar una orden a Firebase para mover el tendedero segun el estado de la ropa:

- Chorreando: 480 minutos / 8 horas
- Humeda: 180 minutos / 3 horas
- Centrifugada: 120 minutos / 2 horas
- Semi-seca: 45 minutos

Para que el ESP8266 obedezca esa orden, agrega el parche de `PARCHE_ARDUINO_COMANDOS.md` al codigo Arduino.
