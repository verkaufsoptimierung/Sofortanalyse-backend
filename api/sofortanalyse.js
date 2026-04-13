// Vercel Serverless Function – Sofortanalyse mit Google Gemini

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Nur POST erlaubt' });

  var body = req.body || {};
  var url = body.url;

  if (!url) return res.status(400).json({ error: 'URL fehlt' });

  var apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY nicht konfiguriert' });

  var systemPrompt = 'Du bist Verkaufspsychologe und Conversion-Optimierer nach der Farkas-Methode, spezialisiert auf verkaufsstarke Websites.\n\nDeine Aufgabe: Analysiere die angegebene URL (nur die Startseite, keine Unterseiten) und finde verkaufspsychologische Optimierungspotentiale.\n\nRegeln:\n- Liefere genau 6-8 kurze, praegnante Stichpunkte\n- Jeder Stichpunkt maximal 1-2 Saetze\n- Fokus auf verkaufspsychologische Hebel: Wertversprechen, Social Proof, Dringlichkeit, CTA-Optimierung, Einwandbehandlung, Vertrauenssignale, Storytelling, User Journey\n- Sei konkret und beziehe Dich auf das, was Du auf der Seite siehst\n- Antworte NUR mit einem JSON-Array von Strings, keine weitere Erklaerung\n- Sprache: Deutsch\n\nBeispiel-Format:\n["Stichpunkt 1","Stichpunkt 2","Stichpunkt 3"]';

  try {
    var geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;

    var response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: systemPrompt + '\n\nAnalysiere diese Website: ' + url }]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1000
        }
      })
    });

    if (!response.ok) {
      var errText = await response.text();
      console.error('Gemini API Fehler:', response.status, errText);
      return res.status(500).json({ error: 'Gemini API Fehler: ' + response.status });
    }

    var data = await response.json();
    var content = data.candidates[0].content.parts[0].text.trim();

    // JSON aus der Antwort extrahieren
    var results;
    try {
      // Manchmal kommt der JSON in einem Code-Block
      var jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        results = JSON.parse(jsonMatch[0]);
      } else {
        results = JSON.parse(content);
      }
    } catch (e) {
      // Fallback: Zeilen als Array
      results = content
        .split('\n')
        .map(function(line) { return line.replace(/^[-•*"\d.]\s*/, '').replace(/[",]$/, '').trim(); })
        .filter(function(line) { return line.length > 10; });
    }

    return res.status(200).json({ results: results });

  } catch (err) {
    console.error('Fehler:', err.message);
    return res.status(500).json({ error: 'Analyse fehlgeschlagen: ' + err.message });
  }
};
