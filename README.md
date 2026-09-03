# Két igaz, egy hamis

Valós idejű, többjátékos osztálytermi játék. A diákok két igaz állítást és egy
hazugságot írnak magukról, a többiek pedig megpróbálják kitalálni, ki írta,
és melyik állítás a kamu.

**Játék:** https://locitanit.github.io/ket-igaz-egy-hamis/

## Technológia

- Egyetlen oldalas alkalmazás (SPA): `index.html` + `style.css` + `app.js`
- Tiszta (vanilla) JS, ES6 modulok – nincs build lépés
- Firebase Realtime Database (moduláris SDK v10)
- GitHub Pages

## Játékmenet

1. **Beküldés** – mindenki (a hoszt is) megadja a nevét, 2 igazságot és 1 hazugságot.
   Az állítások véletlenszerűen megkeveredve kerülnek az adatbázisba; a `lieIndex`
   mező jegyzi meg, melyik a hazugság.
2. **Váróterem** – a hoszt látja, ki küldött be, és ő indítja a játékot.
3. **Melyik a hazugság?** – a játék sorra veszi a játékosokat. Elsőként mindig a
   **hoszt** kerül sorra, utána a többiek véletlen sorrendben. A neve látszik, a
   három állítására kell szavazni. A hoszt zárja le a szavazást, mutatja meg az
   eredményt, majd fedi fel a hazugságot.
4. A játék végén ranglista (minden jó tippért 1 pont, holtverseny kezelve).

## Beállítás

1. `app.js` tetején a `firebaseConfig` objektum – ide jön a saját Firebase projekt
   adata. A `databaseURL` mező kötelező.
2. Realtime Database → Rules:

```json
{
  "rules": {
    "rooms": {
      ".read": true,
      ".write": true
    }
  }
}
```

## Adatszerkezet

```
rooms/
  SZOBAKOD/
    gameState       submitting | guess_lie | reveal_lie | end
    hostId
    activePlayerId
    order[]         a sorrend: [hoszt, ...többiek megkeverve]
    orderIndex
    lieRevealed
    scores/         pontszámok
    players/
      UID/  name, statements[3] (megkeverve), lieIndex, submitted, joinedAt
    votes/
      lie/UID -> 0|1|2
```

## Admin

A fejlécben lévő három pöttyre kattintva előjön egy törlő panel. A titkos kódot
beírva (`ADMIN_CODE` az `app.js` tetején) az összes szoba törlődik az adatbázisból.

## Helyi futtatás

```bash
python -m http.server 8777
```

Majd `http://127.0.0.1:8777`.
