# Parche Arduino: comandos desde la app movil

La app escribe esta ruta en Firebase:

```text
/tendedero/tendedero_01/comando
```

Ejemplo para ropa centrifugada:

```json
{
  "accion": "SECAR_ROPA",
  "estado_ropa": "CENTRIFUGADA",
  "duracion_min": 120,
  "angulo_objetivo": "EXTENDIDO",
  "origen": "app_movil",
  "procesado": false
}
```

El ESP8266 debe leer ese comando, extender el tendedero, esperar el tiempo indicado y luego retraer si ya termino el secado.

## 1. Agrega estas variables en la seccion de timers

```cpp
unsigned long t_ultimo_comando = 0;
unsigned long t_fin_secado = 0;
bool secado_programado_activo = false;
String secado_estado_ropa = "";
```

## 2. Agrega estas funciones antes del `setup()`

```cpp
void marcarComandoProcesado(const String& estado) {
  if (!firebase_listo || WiFi.status() != WL_CONNECTED) return;

  String base = "/tendedero/";
  base += DEVICE_ID;
  base += "/comando";

  Firebase.setBool(fbData, base + "/procesado", true);
  Firebase.setString(fbData, base + "/estado_comando", estado);
  Firebase.setString(fbData, base + "/procesado_en", "uptime_" + String(millis() / 1000) + "s");
}

void leerComandoApp() {
  if (!firebase_listo || WiFi.status() != WL_CONNECTED) return;

  String base = "/tendedero/";
  base += DEVICE_ID;
  base += "/comando";

  if (!Firebase.getBool(fbCmd, base + "/procesado")) return;
  bool procesado = fbCmd.boolData();
  if (procesado) return;

  if (!Firebase.getString(fbCmd, base + "/accion")) return;
  String accion = fbCmd.stringData();
  if (accion != "SECAR_ROPA") {
    marcarComandoProcesado("ACCION_DESCONOCIDA");
    return;
  }

  int duracion_min = 120;
  if (Firebase.getInt(fbCmd, base + "/duracion_min")) {
    duracion_min = fbCmd.intData();
  }

  secado_estado_ropa = "CENTRIFUGADA";
  if (Firebase.getString(fbCmd, base + "/estado_ropa")) {
    secado_estado_ropa = fbCmd.stringData();
  }

  Serial.print(F("[App] Secado programado: "));
  Serial.print(secado_estado_ropa);
  Serial.print(F(" por "));
  Serial.print(duracion_min);
  Serial.println(F(" min"));

  if (lluvia_detectada || esDeNoche()) {
    marcarComandoProcesado("RECHAZADO_LLUVIA_O_NOCHE");
    notificarCambioEstado(
      "SECADO NO INICIADO",
      "No se extendio porque hay lluvia o es de noche."
    );
    return;
  }

  extenderTendedero();
  estado_actual = EST_EXTENDIDO;
  secado_programado_activo = true;
  t_fin_secado = millis() + (unsigned long)duracion_min * 60000UL;

  registrarEventoFirebase("SECADO_APP_" + secado_estado_ropa);
  publicarEstadoFirebase();
  marcarComandoProcesado("SECADO_INICIADO");

  notificarCambioEstado(
    "SECADO PROGRAMADO",
    "Ropa: " + secado_estado_ropa + "\nTiempo: " + String(duracion_min) + " minutos."
  );
}

void controlarSecadoProgramado() {
  if (!secado_programado_activo) return;

  if (lluvia_detectada) {
    secado_programado_activo = false;
    t_fin_secado = 0;
    retraerTendedero();
    estado_actual = EST_RETRAIDO_LLUVIA;
    registrarEventoFirebase("SECADO_CANCELADO_LLUVIA");
    notificarCambioEstado(
      "SECADO CANCELADO",
      "Se detecto lluvia. Tendedero retraido para proteger la ropa."
    );
    return;
  }

  if ((long)(millis() - t_fin_secado) >= 0) {
    secado_programado_activo = false;
    t_fin_secado = 0;
    retraerTendedero();
    estado_actual = EST_RETRAIDO_NOCHE;
    registrarEventoFirebase("SECADO_TERMINADO_" + secado_estado_ropa);
    publicarEstadoFirebase();
    notificarCambioEstado(
      "SECADO TERMINADO",
      "Tiempo completado para ropa " + secado_estado_ropa + ". Tendedero retraido."
    );
  }
}
```

## 3. Agrega esto dentro del `loop()`

Ponlo despues de leer sensores y antes de la maquina de estados:

```cpp
if (ahora - t_ultimo_comando >= 5000UL) {
  t_ultimo_comando = ahora;
  leerComandoApp();
}

controlarSecadoProgramado();
```

## Tiempos usados por la app para Arequipa

- Chorreando: 480 minutos / 8 horas
- Humeda: 180 minutos / 3 horas
- Centrifugada: 120 minutos / 2 horas
- Semi-seca: 45 minutos

Puedes cambiar esos tiempos en `app.js`, en los botones `data-minutes`.
