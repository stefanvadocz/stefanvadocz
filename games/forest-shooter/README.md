# Cesta lesom — 3D strieľačka v prehliadači

FPS z pohľadu prvej osoby. Hráč sa musí prebojovať 400 metrov lesom, v ktorom naňho
útočia vojaci, a dobehnúť k bezpečnému domu na druhej strane. Vydrží najviac **3 zásahy** —
štvrtý znamená koniec. Za každú prežitú sekundu získava 10 bodov, za dosiahnutie domu 500.

## Spustenie

Stačí otvoriť `index.html` v prehliadači — hra nemá žiadne externé závislosti, Three.js je
priložený v repozitári. Funguje aj cez `file://`, aj z webservera.

Publikovaná verzia je v `docs/forest-shooter/` (GitHub Pages).

## Ovládanie

| Akcia | Klávesnica | Dotyk |
|---|---|---|
| Pohyb | `W` `A` `S` `D` | ľavý joystick |
| Rozhliadanie | myš | ťah po obrazovke |
| Streľba | ľavé tlačidlo myši | tlačidlo `PAĽ` |
| Nabitie | `R` | tlačidlo `R` |
| Šprint | `Shift` | — |
| Pauza | `Esc` | — |

## Ako je hra postavená

Všetko je generované kódom — žiadne modely ani obrázky. Textúry (kôra, tráva, maskáče,
zem, dosky) sa kreslia do `<canvas>` pri štarte, stromy sú `InstancedMesh` a zvuky sa
syntetizujú cez WebAudio.

Niekoľko rozhodnutí, ktoré nie sú zrejmé z kódu:

- **Farebný priestor.** Renderer pracuje lineárne a na výstupe konvertuje do sRGB, takže
  všetky farby prechádzajú cez `srgb()` a textúry majú `encoding = sRGBEncoding`. Bez toho
  je celá scéna vyblednutá.
- **Zásahové objemy.** Vojaci majú dva neviditeľné kvádre (telo a hlava), na ktoré sa
  testuje streľba. Lúč na model by prechádzal medzi nohami a okolo trupu.
- **Krytie.** `losBlocked()` rieši kmene ako zvislé valce a testuje ich presne. Vzorkovanie
  lúča po krokoch tenké kmene občas preskočilo a hráč dostával zásahy cez strom, za ktorým stál.
- **Lievik pri dome.** Les sa v poslednom úseku zužuje, takže hráč nemôže prejsť bokom
  popri dome a zaseknúť sa o hranicu sveta.
- **Spätný ráz.** Zdvih hlavne sa sám vracia späť; bez toho by dlhšia dávka natrvalo
  odklonila mierenie nad cieľ.
- **Presnosť vojakov** je zámerne nízka (~11 % na výstrel, prvý výstrel dávky ide vždy vedľa)
  a po zásahu má hráč 1,5 s nesmrteľnosti, aby ho jedna dávka nezložila.

## Obtiažnosť

Overená simulovaným priechodom (5 behov v každom štýle):

- hráč, ktorý len beží a nestrieľa: **0/5 výhier**, padne zhruba v tretine cesty,
- hráč, ktorý sa bráni a využíva kryt: **5/5 výhier**, priemerne 117 s a 1–3 zásahy.

## Ladiaci režim

S parametrom `?debug` sa vystaví `window.__forest` (stav hry, `step(sekundy)` na posun
hernej logiky bez čakania na vykresľovanie, `teleport()`, `losBlocked()`). Parameter
`?nolock` vypne uzamknutie kurzora. Oboje slúži na automatizované testy.
