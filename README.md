# Telugu Voice Voter Search (Next.js + Capacitor + SQLite)

Offline-first utility: speech recognition understands the command, a deterministic SQLite query finds the voter, text-to-speech reads the verified record back in Telugu. No AI/LLM involved.

## What is built (MVP scope)
- Voice search (te-IN) by name, voter ID, house, part, serial, and father/husband name; typed fallback box.
- Multiple matches: the app never auto-picks. It reads the count and asks you to narrow (say a different field, or tap/say a number).
- Import CSV, Excel and text-based PDF with column mapping, preview, validation and de-duplication. Scanned-PDF OCR is **not** included (next phase).
- Encrypted SQLite (SQLCipher via `@capacitor-community/sqlite`, key held by the Android Keystore), batched inserts, rollback on failure.
- Security: admin PIN (required on first launch) for import/database/security settings, optional team PIN + fingerprint/device lock, lockout after 5 wrong PINs, re-lock on background, no export feature, Android backup disabled.
- Database screen: per-list counts, delete one list or all lists. Settings: Telugu capability check, speech speed, voice test.

## Commands
```bash
npm install
npm test               # parser / mapping / query tests
npm run dev            # browser preview (uses an UNENCRYPTED localStorage DB and Web Speech API; dev only)
npm run android:sync   # next build + cap sync
npm run android:open   # open in Android Studio
npm run android:apk    # debug APK -> android/app/build/outputs/apk/debug
```
Requires JDK 17+ and the Android SDK (Android Studio).

## Spoken commands (examples)
`పేరు రాము` · `ఓటరు ఐడి ABC1234567` · `ఇంటి నంబర్ 12-3` · `పార్ట్ నంబర్ 45` · `క్రమ సంఖ్య 210` · `తండ్రి పేరు వెంకయ్య`. A bare name is treated as a name search. Keywords live in `lib/command.ts`.

## Must be tested on the real phones
- Offline Telugu recognition/TTS depends on the device: install the Telugu offline speech pack and Telugu TTS voice data. Settings shows what the device reports.
- Telugu speech recognition of voter IDs (letters + digits) is unreliable; use the typed box or the number/house/part fields as a fallback.
- Large imports (100k+ rows) and PDF layout extraction need testing with your real electoral rolls; PDF rows are rebuilt heuristically from text positions, so check the preview and mapping.
- Name search uses `LIKE %token%` (not indexed); fine for typical constituency sizes, consider FTS5 if slow.
