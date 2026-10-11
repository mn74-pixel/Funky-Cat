# Funky Cat – serwer konkursów na Wixie

1. W edytorze strony włącz tryb deweloperski (Dev Mode), otwórz panel kodu **{ }** → **Backend**.
2. Dodaj trzy pliki o dokładnie tych nazwach i wklej do nich zawartość z tego folderu:
   - `http-functions.js` (przez „+” → „Expose site API”)
   - `funkycat-scorer.js` (przez „+” → „New .js file”)
   - `funkycat-data.js` (przez „+” → „New .js file”)
3. Opublikuj stronę.
4. Test: https://www.nowakowski.net.pl/_functions/challenge?code=TEST powinien zwrócić tekst z `"state":"open"`.

Tabele w CMS (już założone): Funky Cat – konkursy, wyniki, rozgrywki, weryfikacja e-mail.
Nowy konkurs = nowy wiersz w „Funky Cat – konkursy”:
- Kod ze sceny: np. KRAKOW (dla konkursu online też nadaj kod, np. LISTOPAD)
- Rodzaj: `koncert` albo `online`; Tylko z kodem: zaznacz, jeśli konkurs ma nie być widoczny w grze bez kodu
- Start / Koniec, Etap gry (1–3), Liczba nagród, Podejścia dziennie (0 = bez limitu), Aktywny
- QR na koncert: https://mn74-pixel.github.io/Funky-Cat/?kod=KOD

Weryfikacja e-mail w konkursach online: utwórz w Wixie wiadomość automatyczną (Triggered Email) ze zmienną `code`
i wpisz jej ID w `http-functions.js` (stała VERIFY_EMAIL_TEMPLATE_ID). Bez tego konkursy działają bez weryfikacji.
