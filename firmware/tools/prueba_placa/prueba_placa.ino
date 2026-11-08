// Prueba de la placa: ESP32 comun (DevKit) + 1 servo + boton STOP.
//
// Conexiones:
//   Servo naranja (senal) -> GPIO 26   | rojo -> +5 V de la fuente | marron -> GND
//   Boton STOP: un lado a GPIO 32, el otro a GND
//   GND de la ESP32 unido al GND de la fuente. La ESP32 se alimenta SOLO por USB.
//
// Uso: monitor serie a 115200, final de linea "New Line".
//   Escribir un angulo (0-180) y Enter -> mueve el servo.
//   "a" -> afloja el servo (deja de hacer fuerza). El boton STOP tambien lo afloja.
//
// Requiere la libreria ESP32Servo (Kevin Harrington). Placa: "ESP32 Dev Module".

#include <ESP32Servo.h>

const int PIN_SERVO = 26;  // servo del indice (mapa de pines del README)
const int PIN_STOP = 32;   // boton a GND, INPUT_PULLUP
const int PIN_LED = 2;     // LED azul de la placa (algunas placas no lo tienen)

// Pulsos en microsegundos. Algunos 9g golpean el tope mecanico con 2500.
const int PULSO_MIN = 500;
const int PULSO_MAX = 2400;

Servo servo;
bool conectado = false;
bool led = false;

void mover(int ang) {
  if (!conectado) {
    servo.attach(PIN_SERVO, PULSO_MIN, PULSO_MAX);
    conectado = true;
  }
  servo.write(ang);
  Serial.printf("servo -> %d grados\n", ang);
}

void aflojar(const char *motivo) {
  if (conectado) {
    servo.detach();
    conectado = false;
  }
  Serial.printf("servo aflojado (%s)\n", motivo);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_STOP, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  servo.setPeriodHertz(50);
  delay(500);
  // El servo NO se conecta al arrancar: no salta hasta recibir el primer angulo.
  Serial.println("\nprueba_placa lista. Escribi un angulo 0-180, o 'a' para aflojar.");
}

void loop() {
  static uint32_t tLed = 0;
  if (millis() - tLed > 500) {  // parpadeo = la placa esta viva
    tLed = millis();
    led = !led;
    digitalWrite(PIN_LED, led);
  }

  // Avisa cada vez que el boton cambia (con antirrebote de 30 ms), para probar el cableado.
  static int btnAnterior = HIGH;
  static uint32_t tBtn = 0;
  int btn = digitalRead(PIN_STOP);
  if (btn != btnAnterior && millis() - tBtn > 30) {
    tBtn = millis();
    btnAnterior = btn;
    Serial.println(btn == LOW ? "boton: apretado" : "boton: suelto");
  }
  if (btn == LOW && conectado) aflojar("boton STOP");

  if (Serial.available()) {
    String s = Serial.readStringUntil('\n');
    s.trim();
    if (s == "a") {
      aflojar("comando");
    } else if (s.length() > 0 && isDigit(s[0])) {
      int ang = s.toInt();
      if (ang <= 180) mover(ang);
      else Serial.println("angulo fuera de rango (0-180)");
    } else if (s.length() > 0) {
      Serial.println("no entendi: escribi un numero 0-180 o 'a'");
    }
  }
}
