# roll-to-csv

Converts a card-style AP panchayat voter roll PDF (photo cards, 3 per row) into a CSV that the app can import.
The PDFs' embedded Telugu text is corrupted, so ASCII fields (serial, EPIC, house, age) come from the text layer
and Telugu names come from OCR.

```bash
npm install
curl -L -o lang/tel.traineddata https://github.com/tesseract-ocr/tessdata_best/raw/main/tel.traineddata
node convert.mjs "roll.pdf" ../../out/roll.csv
```
Output stays in `out/` (git-ignored: it contains personal data). Always spot-check names against the PDF: OCR is ~90% exact.
