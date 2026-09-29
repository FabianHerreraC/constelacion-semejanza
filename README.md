# Constelación — Imagen y semejanza

Volumen 3D de las opiniones de *Imagen y semejanza* (desde el ensayo del 24-sep) sobre 7 proposiciones polares (0 = primera, 100 = segunda).

- Cada eje tiene sus dos polos en puntos opuestos de una esfera; los 14 polos llevan su proposición como etiqueta.
- Cada persona es un punto en `Σ (v/50 − 1) · dᵢ` (sólo sobre los ejes encendidos): una proyección lineal de 7D a 3D. Si alguien respondió 50 en todo, queda en el centro.
- Los hilos van del punto al polo hacia el que se inclina, con una opacidad que depende de cuánto se inclina.
- Siete botones (o las teclas 1–7) encienden cada proposición. Al principio todos los puntos están juntos en el centro, y cada eje encendido los despliega.
- Clic en un punto: nombre y respuestas. Clic en un polo: quiénes se inclinan hacia ese lado.

Sitio estático (three.js por CDN), sin build.

## Actualizar los datos

Exportar la consulta de Supabase como CSV (columnas `exhibicion,aparicion,nombre,hora,semejanza,…,datos`) y ejecutar:

    node tools/csv2data.mjs ruta/al.csv data.js --desde 2026-09-24

Descarta las filas con `visible=false` y las pruebas anteriores al ensayo.

## Local

    python3 -m http.server

## Un cielo de palabras

`cielo.html` es una pieza independiente: un campo de partículas en canvas 2D que se recorre con el teclado (espacio y flechas; f activa la pantalla completa). Un botón en la esquina superior derecha de cada página lleva a la otra.
